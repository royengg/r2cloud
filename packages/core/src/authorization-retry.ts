import { setTimeout as pause } from 'node:timers/promises';

export async function retryAuthorization<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (attempt >= 2 || !code || !['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code))
        throw error;
      await pause(500);
    }
  }
}
