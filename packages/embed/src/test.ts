import { Database, Session } from "@rtdb2/core";

const db = new Database("./test");

// db.run()

const session = new Session("134");

async function test() {
   const res = await db.run(
      [
         {
            path: ["coll1", "doc1"],
            type: "get",
         },
      ],
      session
   );
   console.log(res);

   await db.run(
      [
         {
            path: ["coll1", "doc1"],
            type: "set",
            data: {
               hi: "hallo" + Date.now(),
            },
         },
      ],
      session
   );

   const res2 = await db.run(
      [
         {
            path: ["coll1", "doc1"],
            type: "get",
         },
      ],
      session
   );
   console.log(res2);
}

test();
