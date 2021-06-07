import { getRawLevelDB, deleteRawLevelDB, resNull } from "../storage";
import DocumentLock from "./lock";
import {
   DocumentQuery,
   CollectionQuery,
   QueryError,
   ITypedQuery,
   IQuery,
} from "./query";
import { LoggingBase, ILoggingInterface } from "@hibas123/logging";
import Session from "./session";
import nanoid = require("nanoid");
import { Observable } from "@hibas123/utils";
import { IRuleEngine } from "../rules";

const ALPHABET =
   "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const longNanoId = nanoid.customAlphabet(ALPHABET, 32);
const shortNanoId = nanoid.customAlphabet(ALPHABET, 16);

// interface ITransaction {
//    queries: ITypedQuery<IWriteQueries>[];
// }

export type ChangeTypes = "added" | "modified" | "deleted";

export type Change = {
   data: any;
   document: string;
   collection: string;
   type: ChangeTypes;
   sender: string;
};

const DummyRuleEngine = {
   hasPermission: () => true,
} as IRuleEngine;

export class Database {
   logging: ILoggingInterface = new LoggingBase({ console: false });
   public static getKey(collectionid: string, documentid?: string) {
      return `${collectionid || ""}/${documentid || ""}`;
   }

   #level = getRawLevelDB(this.database_path);

   get data() {
      return this.#level.data;
   }

   get collections() {
      return this.#level.collection;
   }

   #rules: IRuleEngine;

   get rules() {
      return this.#rules;
   }

   set rules(engine: IRuleEngine | undefined) {
      if (!engine) {
         this.#rules = DummyRuleEngine;
      } else {
         this.#rules = engine;
      }
   }

   public connectionCount = 0;

   private locks = new DocumentLock();
   public collectionLocks = new DocumentLock();

   public changeListener = new Map<string, Set<(change: Change[]) => void>>();
   public collectionChangeListener = new Observable<{
      key: string;
      id: string;
      type: "create" | "delete";
   }>();

   toJSON() {
      return {
         database_path: this.database_path,
         rules: this.#rules,
         connections: this.connectionCount,
      };
   }

   constructor(public database_path: string, ruleEngine?: IRuleEngine) {
      if (ruleEngine) this.#rules = ruleEngine;
      else this.#rules = DummyRuleEngine;
   }

   public async resolve(
      path: string[],
      create = false
   ): Promise<{ collection: string; document: string; collectionKey: string }> {
      path = [...path]; // Create modifiable copy
      let collectionID: string = undefined;
      let documentKey = path.length % 2 === 0 ? path.pop() : undefined;
      let key = path.join("/");

      const lock = await this.collectionLocks.lock(key);

      try {
         collectionID = await this.collections
            .get(key)
            .then((r) => r.toString())
            .catch(resNull);
         if (!collectionID && create) {
            collectionID = longNanoId();
            await this.collections.put(key, collectionID);
            setImmediate(() => {
               this.collectionChangeListener.send({
                  id: collectionID,
                  key,
                  type: "create",
               });
            });
         }
      } finally {
         lock();
      }

      return {
         collection: collectionID,
         document: documentKey,
         collectionKey: key,
      };
   }

   private sendChanges(changes: Change[]) {
      let col = new Map<string, Map<string, Change[]>>();
      changes.forEach((change) => {
         let e = col.get(change.collection);
         if (!e) {
            e = new Map();
            col.set(change.collection, e);
         }

         let d = e.get(change.document);
         if (!d) {
            d = [];
            e.set(change.document, d);
         }

         d.push(change);
      });

      setImmediate(() => {
         for (let [collection, documents] of col.entries()) {
            let collectionChanges = [];
            for (let [document, documentChanges] of documents.entries()) {
               let s = this.changeListener.get(
                  Database.getKey(collection, document)
               );
               if (s) s.forEach((e) => setImmediate(() => e(documentChanges)));

               collectionChanges.push(...documentChanges);
            }
            let s = this.changeListener.get(Database.getKey(collection));
            if (s) s.forEach((e) => setImmediate(() => e(collectionChanges)));
         }
      });
   }

   private validate(query: ITypedQuery<any>) {
      const inv = new QueryError("Malformed query!");
      if (!query || typeof query !== "object") throw inv;

      if (!query.type) throw inv;

      if (!query.path) throw inv;
   }

   async run(queries: IQuery[], session: Session) {
      let resolve: {
         path: string[];
         create: boolean;
         resolved?: [string, string, string];
      }[] = [];

      const addToResolve = (path: string[], create?: boolean) => {
         let entry = resolve.find((e) => {
            //TODO: Find may be slow...
            if (e.path.length !== path.length) return false;
            for (let i = 0; i < e.path.length; i++) {
               if (e.path[i] !== path[i]) return false;
            }
            return true;
         });

         if (!entry) {
            entry = {
               path,
               create,
            };
            resolve.push(entry);
         }

         entry.create = entry.create || create;

         return entry;
      };

      const isBatch = queries.length > 1;
      let parsed = queries.map((rawQuery) => {
         this.logging.debug("Running query:", rawQuery.type);
         this.validate(rawQuery);
         const isCollection = rawQuery.path.length % 2 === 1;

         let query = isCollection
            ? new CollectionQuery(this, session, rawQuery)
            : new DocumentQuery(this, session, rawQuery);

         if (isBatch && !query.batchCompatible)
            throw new Error("There are queries that are not batch compatible!");

         let path = addToResolve(rawQuery.path, query.createCollection);
         if (query.additionalLock) addToResolve(query.additionalLock);

         return {
            path,
            query,
         };
      });

      resolve = resolve.sort((a, b) => a.path.length - b.path.length);

      let locks: (() => void)[] = [];
      for (let e of resolve) {
         let { collection, document, collectionKey } = await this.resolve(
            e.path,
            e.create
         );
         e.resolved = [collection, document, collectionKey];

         locks.push(await this.locks.lock(collection, document));
      }

      let result = [];
      try {
         let batch = this.data.batch();
         let changes: Change[] = [];
         for (let e of parsed) {
            result.push(
               await e.query.run(
                  e.path.resolved[0],
                  e.path.resolved[1],
                  batch,
                  e.path.resolved[2]
               )
            );
            changes.push(...e.query.changes);
         }
         if (batch.length > 0) await batch.write();

         this.sendChanges(changes);
      } finally {
         locks.forEach((lock) => lock());
      }

      if (isBatch) return result;
      else return result[0];
   }

   async snapshot(
      rawQuery: ITypedQuery<"snapshot">,
      session: Session,
      onchange: (change: any) => void
   ) {
      this.logging.debug("Snaphot request:", rawQuery.path);
      this.validate(rawQuery);

      if (rawQuery.type !== "snapshot") throw new Error("Invalid query type!");

      const isCollection = rawQuery.path.length % 2 === 1;
      let query = isCollection
         ? new CollectionQuery(this, session, rawQuery, true)
         : new DocumentQuery(this, session, rawQuery, true);

      const { unsubscribe, value } = await query.snapshot(onchange);

      const id = shortNanoId();
      session.subscriptions.set(id, unsubscribe);
      return {
         id,
         snaphot: value,
      };
   }

   async unsubscribe(id: string, session: Session) {
      let query = session.subscriptions.get(id);
      if (query) {
         query();
         session.subscriptions.delete(id);
      }
   }

   async stop() {
      await this.data.close();
   }

   async delete() {
      await this.stop();
      return deleteRawLevelDB(this.database_path);
   }

   public async runCleanup() {
      const should = await new Promise<Set<string>>((yes, no) => {
         const stream = this.collections.iterator({
            keyAsBuffer: false,
            valueAsBuffer: false,
         });

         const collections = new Set<string>();
         const onValue = (err: Error, key: string, value: string) => {
            if (err) {
               this.logging.error(err);
               stream.end((err) => this.logging.error(err));
               no(err);
            }

            if (!key && !value) {
               yes(collections);
            } else {
               collections.add(value);
               stream.next(onValue);
            }
         };

         stream.next(onValue);
      });

      const existing = await new Promise<Set<string>>((yes, no) => {
         const stream = this.data.iterator({
            keyAsBuffer: false,
            values: false,
         });

         const collections = new Set<string>();
         const onValue = (err: Error, key: string, value: Buffer) => {
            if (err) {
               this.logging.error(err);
               stream.end((err) => this.logging.error(err));
               no(err);
            }

            if (!key && !value) {
               yes(collections);
            } else {
               let coll = key.split("/")[0];
               collections.add(coll);
               stream.next(onValue);
            }
         };

         stream.next(onValue);
      });

      const toDelete = new Set<string>();
      existing.forEach((collection) => {
         if (!should.has(collection)) toDelete.add(collection);
      });

      for (let collection of toDelete) {
         const batch = this.data.batch();

         let gt = Buffer.from(collection + "/ ");
         gt[gt.length - 1] = 0;

         let lt = Buffer.alloc(gt.length);
         lt.set(gt);
         lt[gt.length - 1] = 0xff;

         await new Promise<void>((yes, no) => {
            const stream = this.data.iterator({
               keyAsBuffer: false,
               values: false,
               gt,
               lt,
            });

            const onValue = (err: Error, key: string, value: Buffer) => {
               if (err) {
                  this.logging.error(err);
                  stream.end((err) => this.logging.error(err));
                  no(err);
               }

               if (!key && !value) {
                  yes();
               } else {
                  batch.del(key);
                  stream.next(onValue);
               }
            };

            stream.next(onValue);
         });

         await batch.write();
      }

      return Array.from(toDelete.values());
   }
}
