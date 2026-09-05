import { pool, transaction } from '../packages/core/src/db';
if (process.env.R2_MODE === 'fixture') {
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO organisations(id,name) VALUES('studio','Northstar Studio'),('other','Other organisation') ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO users VALUES('maya','Maya Chen','human'),('alex','Alex Morgan','human'),('sam','Sam Rivera','human'),('outsider','Outside user','human'),('agent','Codex','agent') ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO memberships VALUES('studio','maya'),('studio','alex'),('studio','sam'),('studio','agent'),('other','outsider') ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO repositories(id,org_id,full_name,base_sha) VALUES('website','studio','fixture/website',repeat('a',40)),('other-repo','other','fixture/other',repeat('b',40)) ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO projects VALUES('launch','studio','Website launch','website'),('ideas','studio','Product ideas','website'),('private','other','Private project','other-repo') ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO project_access VALUES('studio','launch','maya',true,true,true),('studio','launch','alex',true,false,false),('studio','launch','sam',false,false,false),('studio','launch','agent',true,false,false),('studio','ideas','maya',true,true,true),('other','private','outsider',true,true,true) ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO provider_connections VALUES('fixture-maya','studio','launch','maya','codex',null,'fixture',true),('fixture-alex','studio','launch','alex','codex',null,'fixture',true),('fixture-agent','studio','launch','agent','codex',null,'fixture',true),('fixture-ideas','studio','ideas','maya','codex',null,'fixture',true) ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO skills VALUES('web-review','1','studio','launch','fixture-skill-v1','Check the acceptance criteria. Report failures and limitations. Request human review; never publish.',true) ON CONFLICT DO NOTHING",
    );
    const tasks = [
      [
        'welcome',
        'Make the first visit feel effortless',
        'Help new visitors understand the product and find their next step.',
        ['Explain the value in one clear headline', 'Give visitors a clear primary action'],
        'High',
      ],
      [
        'pricing',
        'Make pricing easier to compare',
        'Help founders choose the right plan with a clear side-by-side comparison.',
        ['Show what each plan includes', 'Make the page usable on mobile'],
        'High',
      ],
      [
        'contact',
        'Give visitors a simple way to get in touch',
        'Create an approachable contact experience with useful confirmation.',
        ['Validate required fields', 'Confirm that the message was received'],
        'Medium',
      ],
      [
        'mobile',
        'Polish navigation on smaller screens',
        'Keep every destination within easy reach on a phone.',
        ['Navigation works at 375px', 'All controls can be used with a keyboard'],
        'Medium',
      ],
    ];
    for (const [tid, title, outcome, criteria, priority] of tasks)
      await db.query(
        "INSERT INTO tasks(id,org_id,project_id,title,outcome,criteria,priority) VALUES($1,'studio','launch',$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [tid, title, outcome, JSON.stringify(criteria), priority],
      );
  });
}
console.log(
  'Schema ready' + (process.env.R2_MODE === 'fixture' ? ' · fixture project seeded' : ''),
);
await pool.end();
