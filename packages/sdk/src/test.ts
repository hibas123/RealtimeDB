import { describe, it, beforeEach, before } from "mocha";
import DB, { IDocumentRef, UpdateTypes } from "./index";
import * as NanoID from "nanoid";
import * as chai from "chai";
import * as cap from "chai-as-promised";

chai.use(cap);

const { expect } = chai;

import * as assert from "assert";

const delay = (t: number) => new Promise((yes) => setTimeout(yes, t));

const db = new DB(
   "http://localhost:5000",
   "test_database",
   "access87125t487123897458725123",
   undefined,
   "root12341213312312365465as4df6"
);

const collName = (name: string) => name + "_" + NanoID.nanoid();

const collections = {
   createRef: collName("coll_ref"),
   deleteEmpty: collName("delete_empty"),
   getKeysOfEmpty: collName("keys_empty"),
   addDoc: collName("add_doc"),
   getDoc: collName("get_doc"),
   updateDocWithSet: collName("update_set"),
   updateDocWithUpdate: collName("update_update"),
   subscribingDocChanges: collName("subscribe_doc"),
   subscribingColChanges: collName("subscribe_coll"),
   whereQueries: collName("where_queries"),
   deleteDoc: collName("delete_doc"),
};

describe("", () => {
   before(async () => {
      await db.offline.awaitValue(false);
   });

   it("Creating Collection Reference", () => {
      const coll = db.collection(collections.createRef);
      expect(coll).not.be.undefined;
   });

   it("Getting keys of empty collection", async () => {
      const coll = db.collection(collections.getKeysOfEmpty);
      await expect(coll.keys()).to.eventually.have.lengthOf(0);
   });

   it("Add doc to collection", async () => {
      const coll = db.collection(collections.addDoc);

      const dat = {
         hello: "world",
      };

      const doc = coll.add(dat);

      await expect(doc).to.eventually.be.not.undefined.and.has.property(
         "id",
         "ID not set!"
      );

      await expect(coll.keys())
         .to.eventually.have.lengthOf(
            1,
            "Not the correct amount of keys returned"
         )
         .and.to.include.members([(await doc).id]);
   });

   it("Get data from doc", async () => {
      const coll = db.collection(collections.getDoc);

      const dat = {
         hello: "world",
      };
      const doc = await coll.add(dat);

      await expect(doc.get()).to.eventually.be.deep.equal(dat);
   });

   it("Update doc using set", async () => {
      const coll = db.collection(collections.updateDocWithSet);

      const dat = {
         hello: "world",
      };
      const doc = await coll.add<any>(dat);

      await expect(doc.get()).to.eventually.be.deep.equal(
         dat,
         "Data returned not as expected!"
      );

      const dat2 = {
         world: "hello",
      };

      await doc.set(dat2);

      await expect(doc.get()).to.eventually.be.deep.equal(
         dat2,
         "Data returned after update not as expected!"
      );
   });

   it("Update doc using update", async () => {
      const coll = db.collection(collections.updateDocWithUpdate);

      const dat = {
         hello: "world",
         cnt: 1,
         arr: [1],
      };
      const doc = await coll.add<any>(dat);

      await expect(doc.get()).to.eventually.be.deep.equal(
         dat,
         "dat returned not as set!"
      );

      await doc.update({
         cnt: UpdateTypes.Increment(1),
      });

      dat.cnt++;

      await expect(doc.get()).to.eventually.be.deep.equal(
         dat,
         "cnt was not incremented!"
      );

      await doc.update({
         arr: UpdateTypes.Push(2),
      });

      dat.arr.push(2);

      await expect(doc.get()).to.eventually.be.deep.equal(
         dat,
         "value was not pushed to arr!"
      );

      dat.hello = "world2";
      await doc.update({
         hello: UpdateTypes.Value("world2"),
      });

      await expect(doc.get()).to.eventually.be.deep.equal(
         dat,
         "value was not applied to hello!"
      );
   });

   it("Subscribing to doc changes", async () => {
      let receivedChanges = 0;

      const coll = db.collection(collections.subscribingDocChanges);

      const doc = await coll.add({ test: 1 });

      const snap = await doc.onSnapshot();
      const r = (async () => {
         for await (const sh of snap) {
            receivedChanges++;
         }
      })();

      try {
         await doc.set({ test: 2 });

         await doc.update({ test: UpdateTypes.Increment(1) });

         await doc.delete();

         await delay(100);

         assert.strictEqual(receivedChanges, 3);
      } finally {
         snap.close();
         await r;
      }
   });

   it("Subscribing to collection changes", async () => {
      let receivedChanges = 0;

      const coll = db.collection(collections.subscribingColChanges);
      const snap = await coll.onSnapshot();
      const r = (async () => {
         for await (const sh of snap) {
            receivedChanges++;
         }
      })();
      try {
         const doc = await coll.add({ test: 1 });

         await doc.set({ test: 2 });

         await doc.update({ test: UpdateTypes.Increment(1) });

         await doc.delete();

         await delay(100);
         assert.strictEqual(receivedChanges, 4);
      } finally {
         snap.close();
         await r;
      }
   });

   it("Deleting (maybe) empty collection", async () => {
      const coll = db.collection(collections.deleteEmpty);
      assert.notStrictEqual(coll, undefined);
      await coll.delete();
   });

   it("Where queries", async () => {
      const coll = db.collection<{ i: number }>(collections.whereQueries);
      let prms = [];
      for (let i = 0; i < 100; i++) {
         prms.push(coll.add({ i }));
      }
      await Promise.all(prms);

      const res = await coll.where("i", ">=", 50).get();
      assert.strictEqual(res.size, 50);
      res.docs.forEach((doc) => assert(doc.data().i >= 50));
   });

   it("Teardown", async () => {
      await Promise.all(
         Object.values(collections).map((e) => db.collection(e).delete())
      );
      db.close();
   });
});
