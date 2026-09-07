import json, os, pathlib, pwd, socket, subprocess, threading, time

root = pathlib.Path("/tmp/r2cloud-control")
root.mkdir(mode=0o700, exist_ok=True)
(root / "in").mkdir(exist_ok=True)
(root / "out").mkdir(exist_ok=True)
(root / "events").mkdir(exist_ok=True)
event_seq = 0
event_batch = []
turn_started = None
clients = set()
lock = threading.RLock()


def emit(value):
    data = (json.dumps(value) + "\n").encode()
    for client in list(clients):
        try:
            client.sendall(data)
        except OSError:
            clients.discard(client)
            client.close()


agent = pwd.getpwnam("r2-agent")
home = pathlib.Path(agent.pw_dir) / ".codex"
home.mkdir(mode=0o700, exist_ok=True)
os.chown(home, agent.pw_uid, agent.pw_gid)


def unprivileged():
    os.setgroups([])
    os.setgid(agent.pw_gid)
    os.setuid(agent.pw_uid)


proc = subprocess.Popen(
    [
        "codex",
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        'cli_auth_credentials_store="file"',
    ],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    cwd=agent.pw_dir,
    preexec_fn=unprivileged,
    env={
        "PATH": "/opt/r2cloud/bin:" + os.environ["PATH"],
        "HOME": str(home),
        "CODEX_HOME": str(home),
        "LANG": "C.UTF-8",
    },
    text=True,
)


def save(name, value):
    temp = root / (name + ".tmp")
    temp.write_text(json.dumps(value))
    temp.replace(root / name)


def listen():
    global event_seq, event_batch
    for line in proc.stdout:
        if len(line) > 1048576:
            proc.kill()
            return
        try:
            message = json.loads(line)
            ident = message.get("id")
            if message.get("method"):
                event_seq += 1
                if event_seq > 20000:
                    proc.kill()
                    return
                if (event_seq - 1) % 10 == 0:
                    event_batch = []
                event_batch.append(
                    {
                        "seq": event_seq,
                        "message": message,
                        "providerElapsedMs": (
                            round((time.monotonic() - turn_started) * 1000)
                            if turn_started is not None
                            else None
                        ),
                    }
                )
                save(
                    "events/batch-" + str((event_seq - 1) // 10) + ".json", event_batch
                )
                save("events/head.json", {"seq": event_seq})
                with lock:
                    emit({"event": event_batch[-1]})
            if (
                isinstance(ident, str)
                and len(ident) == 64
                and (not message.get("method"))
            ):
                save("out/" + ident + ".json", message)
                with lock:
                    emit({"key": ident, "response": message})
            elif message.get("method") == "turn/completed":
                save("turn.json", message.get("params", {}))
            elif (
                message.get("method") == "item/completed"
                and message.get("params", {}).get("item", {}).get("type")
                == "agentMessage"
            ):
                save(
                    "message.json",
                    {"text": str(message["params"]["item"].get("text", ""))[-16000:]},
                )
            elif message.get("method") == "item/agentMessage/delta":
                save(
                    "progress.json",
                    {"text": str(message.get("params", {}).get("delta", ""))[-16000:]},
                )
        except (ValueError, OSError):
            proc.kill()
            return


threading.Thread(target=listen, daemon=True).start()
seen = set()


def lines(client):
    buffer = b""
    while True:
        try:
            data = client.recv(65536)
        except socket.timeout:
            continue
        if not data:
            return
        buffer += data
        if len(buffer) > 1048576:
            return
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            yield line


def accept(client):
    global turn_started
    client.settimeout(5)
    try:
        for line in lines(client):
            if len(line) > 1048576:
                break
            command = json.loads(line)
            with lock:
                if "cursor" in command:
                    cursor = int(command["cursor"])
                    for batch in range(cursor // 10, (event_seq + 9) // 10):
                        for entry in json.loads(
                            (
                                root / ("events/batch-" + str(batch) + ".json")
                            ).read_text()
                        ):
                            if entry["seq"] > cursor:
                                client.sendall(
                                    (json.dumps({"event": entry}) + "\n").encode()
                                )
                    clients.add(client)
                    client.sendall(b'{"ready":true}\n')
                    continue
                key = command["key"]
                if len(key) != 64 or any((c not in "0123456789abcdef" for c in key)):
                    break
                response = root / ("out/" + key + ".json")
                if response.exists():
                    client.sendall(
                        (
                            json.dumps(
                                {
                                    "key": key,
                                    "response": json.loads(response.read_text()),
                                }
                            )
                            + "\n"
                        ).encode()
                    )
                    continue
                if key in seen:
                    continue
                if command.get("lookup"):
                    client.sendall(
                        (json.dumps({"key": key, "unresolved": True}) + "\n").encode()
                    )
                    continue
                message = command["message"]
                seen.add(key)
                save("in/" + key + ".json", message)
                if message.get("method") == "turn/start":
                    turn_started = time.monotonic()
                proc.stdin.write(json.dumps(message) + "\n")
                proc.stdin.flush()
                if "id" not in message or "method" not in message:
                    ack = {"notified": True}
                    save("out/" + key + ".json", ack)
                    client.sendall(
                        (json.dumps({"key": key, "response": ack}) + "\n").encode()
                    )
    except (ValueError, OSError, KeyError):
        pass
    finally:
        with lock:
            clients.discard(client)
        client.close()


server = socket.socket(socket.AF_UNIX)
server.bind(str(root / "bridge.sock"))
server.listen(2)


def connections():
    while proc.poll() is None:
        client, _ = server.accept()
        threading.Thread(target=accept, args=(client,), daemon=True).start()


threading.Thread(target=connections, daemon=True).start()
proc.wait()
with lock:
    emit({"exit": proc.returncode})
save("exit.json", {"code": proc.returncode})
