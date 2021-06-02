import { Database, Change, ChangeTypes } from "./database";
import { resNull } from "../storage";
import * as nanoid from "nanoid";
import Logging from "@hibas123/logging";
import * as MSGPack from "msgpack5";
import Session from "./session";
import { LevelUpChain } from "levelup";
import { Operations } from "../rules";

export type IWriteQueries = "set" | "update" | "delete" | "add";
export type ICollectionQueries =
   | "get"
   | "add"
   | "keys"
   | "delete-collection"
   | "list";
export type IDocumentQueries = "get" | "set" | "update" | "delete";

export interface ITypedQuery<T> {
   path: string[];
   type: T;
   data?: any;
   options?: any;
}

export type IQuery = ITypedQuery<
   ICollectionQueries | IDocumentQueries | "snapshot"
>;

export const MP = MSGPack({});

// MSGPack.initialize(2 ** 20);

const ALPHABET =
   "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const longNanoID = nanoid.customAlphabet(ALPHABET, 32);

const { encode, decode } = MP;

type Runner = (
   collection: string,
   document: string,
   batch: LevelUpChain,
   collectionKey: string
) => any;

interface IPreparedQuery {
   createCollection: boolean;
   needDocument: boolean;
   batchCompatible: boolean;
   runner: Runner;
   permission: Operations;
   additionalLock?: string[];
}

interface DocRes {
   id: string;
   data: any;
}

export abstract class Query {
   /**
    * Returns true if the path only contains valid characters and false if it doesn't
    * @param path Path to be checked
    */
   private validatePath(path: string[]) {
      return path.every(
         (e) => (e.match(/[^a-zA-Z0-9_\-\<\>]/g) || []).length === 0
      );
   }

   public changes: Change[] = [];

   public readonly createCollection: boolean;
   public readonly needDocument: boolean;
   public readonly batchCompatible: boolean;
   public readonly additionalLock?: string[];
   public readonly permission: Operations;
   private readonly _runner: Runner;

   constructor(
      protected database: Database,
      protected session: Session,
      protected query: IQuery,
      snapshot = false
   ) {
      if (query.path.length > 10) {
         throw new QueryError(
            "Path is to long. Path is only allowed to be 10 Layers deep!"
         );
      }
      if (!this.validatePath(query.path)) {
         throw new QueryError(
            "Path can only contain a-z A-Z 0-9  '-' '-' '<' and '>' "
         );
      }

      if (!snapshot) {
         let data = this.prepare(query);
         this.createCollection = data.createCollection;
         this.needDocument = data.needDocument;
         this.batchCompatible = data.batchCompatible;
         this.additionalLock = data.additionalLock;
         this.permission = data.permission;
         this._runner = data.runner;
      }
   }

   protected abstract prepare(query: IQuery): IPreparedQuery;

   protected getDoc(collection: string, document: string) {
      return this.database.data
         .get(Database.getKey(collection, document), { asBuffer: true })
         .then((res) => decode(res as Buffer))
         .catch(resNull);
   }

   protected sendChange(
      collection: string,
      document: string,
      type: ChangeTypes,
      data: any
   ) {
      let change: Change = {
         type,
         document,
         collection,
         data,
         sender: this.session.id,
      };

      Logging.debug("Sending change:", change);

      this.changes.push(change);
   }

   protected static getConstructorParams(
      query: Query
   ): [Database, Session, IQuery] {
      return [query.database, query.session, query.query];
   }

   protected abstract checkChange(change: Change): boolean;
   protected abstract firstSend(
      collection: string,
      document: string
   ): Promise<any>;

   public run(
      collection: string,
      document: string,
      batch: LevelUpChain,
      collectionKey: string
   ) {
      let perm = this.database.rules.hasPermission(
         this.query.path,
         this.permission,
         this.session
      );

      if (!perm) throw new QueryError("No permission!");

      // this.query.path = perm.path;
      return this._runner.call(
         this,
         collection,
         document,
         batch,
         collectionKey
      );
   }

   public async snapshot(
      onChange: (change: (DocRes & { type: ChangeTypes })[]) => void
   ) {
      let perm = this.database.rules.hasPermission(
         this.query.path,
         "read",
         this.session
      );
      if (!perm) {
         throw new QueryError("No permission!");
      }

      const receivedChanges = (changes: Change[]) => {
         let res = changes
            .filter((change) => this.checkChange(change))
            .map((change) => {
               return {
                  id: change.document,
                  data: change.data,
                  type: change.type,
               };
            });
         if (res.length > 0) onChange(res);
      };

      const unsub = this.database.collectionChangeListener.subscribe(
         (change) => {
            if (change.key === collectionKey) {
               if (change.type === "create") addSubscriber(change.id);
               else removeSubscriber(); // Send delete for all elements (Don't know how to do this...)
            }
         }
      );

      let { collection, document, collectionKey } = await this.database.resolve(
         this.query.path
      );
      let oldKey: string = undefined;

      const removeSubscriber = () => {
         if (!oldKey) return;
         let s = this.database.changeListener.get(oldKey);
         if (s) {
            s.delete(receivedChanges);
            if (s.size <= 0) this.database.changeListener.delete(oldKey);
         }
         oldKey = undefined;
      };

      const addSubscriber = (collection: string) => {
         let key = Database.getKey(collection, document);
         if (oldKey !== key) {
            if (oldKey !== undefined) removeSubscriber();

            let s = this.database.changeListener.get(key);
            if (!s) {
               s = new Set();
               this.database.changeListener.set(key, s);
            }

            s.add(receivedChanges);
         }
      };

      if (collection) {
         addSubscriber(collection);
      }

      return {
         unsubscribe: () => {
            unsub();
            removeSubscriber();
         },
         value: await this.firstSend(collection, document),
      };
   }
}

interface UpdateData {
   [path: string]: {
      type: "value" | "timestamp" | "increment" | "push";
      value: any;
   };
}
export class DocumentQuery extends Query {
   prepare(query: IQuery): IPreparedQuery {
      let type = query.type as IDocumentQueries;
      switch (type) {
         case "get":
            return {
               batchCompatible: false,
               createCollection: false,
               needDocument: false,
               permission: "read",
               runner: this.get,
            };
         case "set":
            return {
               batchCompatible: true,
               createCollection: true,
               needDocument: true,
               permission: "write",
               runner: this.set,
            };
         case "update":
            return {
               batchCompatible: true,
               createCollection: true,
               needDocument: true,
               permission: "write",
               runner: this.update,
            };
         case "delete":
            return {
               batchCompatible: true,
               createCollection: false,
               needDocument: true,
               permission: "write",
               runner: this.delete,
            };
         default:
            throw new Error("Invalid query type: " + type);
      }
   }

   private async get(collection: string, document: string) {
      if (!collection || !document) {
         return null;
      }

      return this.getDoc(collection, document);
   }

   private async set(
      collection: string,
      document: string,
      batch?: LevelUpChain
   ) {
      const { data, options } = this.query;
      if (data === null) return this.delete(collection, document, batch);

      let isNew = !(await this.getDoc(collection, document));
      batch.put(Database.getKey(collection, document), encode(data));
      this.sendChange(collection, document, isNew ? "added" : "modified", data);
   }

   private async update(
      collection: string,
      document: string,
      batch?: LevelUpChain
   ) {
      const updateData: UpdateData = this.query.data;

      let data = await this.getDoc(collection, document);
      let isNew = false;
      if (!data) {
         isNew = true;
         data = {};
      }

      for (let path in updateData) {
         const toUpdate = updateData[path];
         let d = data;
         let parts = path.split(".");
         while (parts.length > 1) {
            let seg = parts.shift();
            if (!data[seg]) data[seg] = {};
            d = data[seg];
         }

         const last = parts[0];

         switch (toUpdate.type) {
            case "value":
               d[last] = toUpdate.value;
               break;
            case "increment":
               if (d[last] === undefined || d[last] === null)
                  d[last] = toUpdate.value;
               else if (typeof d[last] !== "number") {
                  throw new QueryError("Field is no number!");
               } else {
                  d[last] += toUpdate.value;
               }
               break;
            case "timestamp":
               d[last] = new Date().valueOf();
               break;
            case "push":
               if (d[last] === undefined || d[last] === null)
                  d[last] = [toUpdate.value];
               else if (Array.isArray(d[last])) {
                  d[last].push(toUpdate.value);
               } else {
                  throw new QueryError("Field is not array!");
               }
               break;
            default:
               throw new QueryError("Invalid update type: " + toUpdate.type);
         }
      }

      if (batch) {
         batch.put(Database.getKey(collection, document), encode(data));
      } else {
         await this.database.data.put(
            Database.getKey(collection, document),
            encode(data).slice(0)
         );
      }

      this.sendChange(collection, document, isNew ? "added" : "modified", data);
   }

   private async delete(
      collection: string,
      document: string,
      batch?: LevelUpChain
   ) {
      if (batch) {
         batch.del(Database.getKey(collection, document));
      } else {
         await this.database.data.del(Database.getKey(collection, document));
      }

      this.sendChange(collection, document, "deleted", null);
   }

   checkChange(change: Change) {
      return true;
   }

   firstSend(collection: string, document: string) {
      return this.get(collection, document);
   }

   public static fromQuery(query: Query) {
      return new DocumentQuery(...Query.getConstructorParams(query));
   }
}

type FieldPath = string;
type WhereFilterOp =
   | "<"
   | "<="
   | "=="
   | ">="
   | ">"
   | "array-contains"
   | "in"
   | "array-contains-any";

interface IQueryWhereVerbose {
   fieldPath: FieldPath;
   opStr: WhereFilterOp;
   value: any;
}

type IQueryWhereArray = [FieldPath, WhereFilterOp, any];

type IQueryWhere = IQueryWhereArray | IQueryWhereVerbose;

export class CollectionQuery extends Query {
   private _addId: string;

   prepare(query): IPreparedQuery {
      switch (query.type as ICollectionQueries) {
         case "add":
            this._addId = longNanoID();
            return {
               batchCompatible: true,
               createCollection: true,
               needDocument: false,
               runner: this.add,
               permission: "write",
               additionalLock: [...query.path, this._addId],
            };
         case "get":
            const limit = (query.options || {}).limit;
            if (limit) this.limit = limit;
            const where = (query.options || {}).where;
            if (where) this.where = where;

            return {
               batchCompatible: false,
               createCollection: false,
               needDocument: false,
               permission: "read",
               runner: this.get,
            };
         case "keys":
            return {
               batchCompatible: false,
               createCollection: false,
               needDocument: false,
               permission: "list",
               runner: this.keys,
            };
         case "list":
            return {
               batchCompatible: false,
               createCollection: false,
               needDocument: false,
               permission: "read",
               runner: this.keys,
            };
         case "delete-collection":
            return {
               batchCompatible: false,
               createCollection: false,
               needDocument: false,
               permission: "write",
               runner: this.deleteCollection,
            };
         // run = () => q.deleteCollection();
         // break;
         default:
            throw new Error("Invalid query!");
      }
   }

   private _where: IQueryWhereArray[];
   public set where(value: IQueryWhere[]) {
      const invalidWhere = new QueryError("Invalid Where");
      if (!Array.isArray(value)) throw invalidWhere;
      let c = [];
      this._where = value.map((cond) => {
         Logging.debug("Query Condition", cond);
         if (Array.isArray(cond)) {
            if (cond.length !== 3) throw invalidWhere;
            return cond;
         } else {
            if (
               cond &&
               typeof cond === "object" &&
               "fieldPath" in cond &&
               "opStr" in cond &&
               "value" in cond
            ) {
               return [cond.fieldPath, cond.opStr, cond.value];
            } else {
               throw invalidWhere;
            }
         }
      });
   }

   public limit: number = -1;

   public async add(
      collection: string,
      document: string,
      batch: LevelUpChain,
      collectionKey: string
   ) {
      let q = new DocumentQuery(this.database, this.session, {
         type: "set",
         path: this.additionalLock,
         data: this.query.data,
         options: this.query.options,
      });
      await q.run(collection, this._addId, batch, collectionKey);
      this.changes = q.changes;
      return this._addId;
   }

   private getStreamOptions(collection: string) {
      let gt = Buffer.from(Database.getKey(collection) + " ");
      gt[gt.length - 1] = 0;

      let lt = Buffer.alloc(gt.length);
      lt.set(gt);
      lt[gt.length - 1] = 0xff;

      return {
         gt,
         lt,
      };
   }

   public async keys(collection: string) {
      if (!collection) return [];

      return new Promise<string[]>((yes, no) => {
         let keys = [];
         const stream = this.database.data.createKeyStream({
            ...this.getStreamOptions(collection),
            keyAsBuffer: false,
         });
         stream.on("data", (key: string) => {
            let s = key.split("/", 2);
            if (s.length > 1) keys.push(s[1]);
         });
         stream.on("end", () => yes(keys));
         stream.on("error", no);
      });
   }

   private _getFieldValue(data: any, path: FieldPath) {
      let parts = path.split(".");
      let d = data;
      while (parts.length > 0) {
         let seg = parts.shift();

         d = data[seg];
         if (d === undefined || d === null) break; // Undefined/Null has no other fields!
      }
      return d;
   }

   private _fitsWhere(data: any): boolean {
      if (this._where && this._where.length > 0) {
         return this._where.every(([fieldPath, opStr, value]) => {
            let val = this._getFieldValue(data, fieldPath);
            switch (opStr) {
               case "<":
                  return val < value;
               case "<=":
                  return val <= value;
               case "==":
                  return val == value;
               case ">=":
                  return val >= value;
               case ">":
                  return val > value;
               case "array-contains":
                  if (Array.isArray(val)) {
                     return val.some((e) => e === value);
                  }

                  return false;
               // case "array-contains-any":
               case "in":
                  if (typeof val === "object") {
                     return value in val;
                  }
                  return false;
               default:
                  throw new QueryError("Invalid where operation " + opStr);
            }
         });
      }
      return true;
   }

   async get(collection: string) {
      if (!collection) return [];

      return new Promise<DocRes[]>((yes, no) => {
         const stream = this.database.data.iterator({
            ...this.getStreamOptions(collection),
            keyAsBuffer: false,
            valueAsBuffer: true,
         });

         let values: DocRes[] = [];

         const onValue = (err: Error, key: string, value: Buffer) => {
            if (err) {
               no(err);
               stream.end((err) => Logging.error(err));
            } else {
               if (!key && !value) {
                  // END
                  Logging.debug("Checked all!");
                  yes(values);
               } else {
                  let s = key.split("/", 2);
                  if (s.length <= 1) return;

                  const id = s[1];

                  let data = decode(value);
                  if (this._fitsWhere(data)) {
                     if (this.limit < 0 || values.length < this.limit) {
                        values.push({
                           id,
                           data,
                        });
                     } else {
                        stream.end((err) => (err ? no(err) : yes(values)));
                        return;
                     }
                  }

                  stream.next(onValue);
               }
            }
         };

         stream.next(onValue);
      });
   }

   checkChange(change: Change) {
      return this._fitsWhere(change.data);
   }

   firstSend(collection: string) {
      return this.get(collection);
   }

   public async collections() {
      if (!this.session.root) throw new QueryError("No Permission!");

      return new Promise<string[]>((yes, no) => {
         let keys = [];
         const stream = this.database.data.createKeyStream({
            keyAsBuffer: false,
         });
         stream.on("data", (key: string) => keys.push(key.split("/")));
         stream.on("end", () => yes(keys));
         stream.on("error", no);
      });
   }

   public async deleteCollection(
      collection: string,
      document: string,
      _b: LevelUpChain,
      collectionKey: string
   ) {
      if (!this.session.root) throw new QueryError("No Permission!");

      //TODO: Lock whole collection!
      let batch = this.database.data.batch();
      try {
         if (collection) {
            let documents = await this.keys(collection);
            // Logging.debug("To delete:", documents)
            for (let document of documents) {
               batch.del(Database.getKey(collection, document));
            }
            await batch.write();
            batch = undefined;
            await this.database.collections.del(collectionKey);
            this.database.collectionChangeListener.send({
               id: collection,
               key: collectionKey,
               type: "delete",
            });
         }
      } finally {
         if (batch) batch.clear();
      }
   }

   public static fromQuery(query: Query) {
      return new CollectionQuery(...Query.getConstructorParams(query));
   }
}

export class QueryError extends Error {
   constructor(message: string) {
      super(message);
   }
}
