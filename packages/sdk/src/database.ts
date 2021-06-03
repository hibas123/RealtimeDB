import {
   DocumentChangeType,
   DocumentUpdate,
   FieldPath,
   ICollectionRef,
   IDocumentChange,
   IDocumentRef,
   IDocumentSnapshot,
   IncrementSymbol,
   IQuery,
   IQuerySnapshot,
   OrderByDirection,
   PushSymbol,
   TimestampSymbol,
   WhereFilterOp,
   IBulk,
} from "./types";

import * as NanoID from "nanoid";
import * as Utils from "@hibas123/utils";
import * as WebSocket from "ws";
import isEqual = require("lodash.isequal");

const delay = (time: number) => new Promise((yes) => setTimeout(yes, time));

const ALPHABET =
   "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

interface Change {
   data: any;
   document: string;
   type: DocumentChangeType;
}

type IWriteQueries = "set" | "update" | "delete" | "add";
type ICollectionQueries = "get" | "add" | "keys" | "delete-collection" | "list";
type IDocumentQueries = "get" | "set" | "update" | "delete";

type ICallQueryTypes =
   | IWriteQueries
   | ICollectionQueries
   | IDocumentQueries
   | "snapshot"
   | "unsubscribe";

interface ITypedQuery<T> {
   path: string[];
   type: T;
   data?: any;
   options?: any;
}

type DocRes = {
   id: string;
   data: any;
};

const custNano = NanoID.customAlphabet(ALPHABET, 21);
const docNanoID = NanoID.customAlphabet(ALPHABET, 32);

abstract class Snapshot<T> {
   protected id: string = custNano();
   public isSubscribed: boolean = false;

   abstract subscribe(): Promise<() => void>;
   abstract unsubscribe(): void;
   abstract receivedData(data: T): void;
   abstract resubscribe(): void;
   abstract destroy(): void;
}

const QueryRequest = Symbol("queryRequest");
const Snapshots = Symbol("snapshots");

export class OfflineError extends Error {
   constructor() {
      super("Offline");
   }
}

// TODO: Request Timeout
export default class Database {
   #offlineStore = new Utils.AwaitStore(true);
   #closedStore = new Utils.AwaitStore(false);
   #requests = new Map<string, (err?: Error, data?: any) => void>();
   #request = new Utils.AsyncIteratorFromCB<string>();

   [Snapshots] = new Map<string, Snapshot<any>>();

   public get offline() {
      return {
         state: this.#offlineStore.value,
         ...this.#offlineStore.getPublicApi(),
      };
   }

   #url: URL;
   constructor(
      url: string,
      database: string,
      accesskey?: string,
      authkey?: string,
      rootkey?: string
   ) {
      const u = new URL(url);
      if (authkey) u.searchParams.set("authkey", authkey);
      if (rootkey) u.searchParams.set("rootkey", rootkey);
      if (accesskey) u.searchParams.set("accesskey", accesskey);

      if (u.protocol === "http:") {
         u.protocol = "ws:";
      } else if (u.protocol === "https:") {
         u.protocol = "wss:";
      }

      u.searchParams.set("database", database);
      this.#url = u;

      this._connection();
   }

   private async _connection() {
      const socketStore = new Utils.AwaitStore<undefined | WebSocket>(
         undefined
      );

      this.#closedStore.subscribe((val) => {
         if (val === true) {
            socketStore.value?.close(); //TODO: Make gracefull shutdown
         }
      });

      (async () => {
         for await (const message of this.#request) {
            if (this.#closedStore.value) return;

            await socketStore.awaitValue((value: any) => value !== undefined);

            const data = new TextEncoder().encode(message);
            await new Promise<void>((yes, no) =>
               socketStore.value.send(data, (err) => (err ? no(err) : yes()))
            );
         }
      })();

      while (true) {
         try {
            if (this.#closedStore.value) return;
            const socket = new WebSocket(this.#url.href);
            await new Promise<void>((yes, no) => {
               socket.once("open", yes);
               socket.once("error", no);
            });
            this.#offlineStore.send(false); // Online now
            socketStore.send(socket);
            socket.on("message", (data: WebSocket.Data) => {
               if (data instanceof ArrayBuffer) {
                  data = new TextDecoder().decode(data);
               } else if (data instanceof Buffer) {
                  data = data.toString("utf-8");
               } else if (Array.isArray(data)) {
                  data = Buffer.concat(data).toString("utf-8");
               } else {
                  let message: {
                     ns: string;
                     data: any;
                  } = JSON.parse(data);

                  switch (message.ns) {
                     case "message":
                        this.handleResponse(message.data);
                        break;
                     case "snapshot":
                        this.handleSnapshot(message.data);
                        break;
                     case "error_msg":
                        // TODO: Some kind of error handling etc.
                        console.log("Server error:", message.data);
                        break;
                  }
               }
            });

            socket.on("ping", (data) => {
               socket.pong(data);
            });

            socket.on("pong", () => {
               //TODO: Maybe add somthing here?
            });

            await new Promise<void>((yes, no) => {
               socket.once("close", () => {
                  if (this.#closedStore.value) return;
                  yes();
               });

               socket.on("error", no);
            });
         } catch (err) {
            console.log(err);
         }
         await delay(1000);
      }
   }

   private handleSnapshot({ id, data }: { id: string; data: any }) {
      let handler = this[Snapshots].get(id);
      if (handler) handler.receivedData(data);
   }

   private handleResponse({
      id,
      error,
      data,
   }: {
      id: string;
      error: boolean;
      data: string;
   }) {
      let req = this.#requests.get(id);
      if (req) {
         if (error) req(new Error(data), undefined);
         else req(undefined, data);
      } else {
         console.error("Invalid response", id);
      }
   }

   public async [QueryRequest]<T = any>(
      query?:
         | ITypedQuery<ICallQueryTypes>
         | ITypedQuery<"set" | "update" | "delete">[],
      id?: string,
      ns: string = "v2"
   ): Promise<T> {
      if (!id) id = custNano();
      return new Promise<any>(async (yes, no) => {
         let offlinePrms:
            | (Promise<boolean> & { ignore: () => void })
            | undefined;

         const finish = (err: Error, data: any) => {
            clearTimeout(to);
            err ? no(err) : yes(data);
            if (offlinePrms) offlinePrms.ignore();
            // @ts-ignore
            this.#requests.delete(id);
         };

         let to = setTimeout(() => {
            finish(new Error("Timeout!"), undefined);
         }, 15000);

         await this.#offlineStore.awaitValue(false);

         // @ts-ignore
         offlinePrms = this.#offlineStore.awaitValue(true);

         // @ts-ignore
         offlinePrms.then(() => {
            offlinePrms = undefined;
            finish(new OfflineError(), undefined);
         });

         // @ts-ignore
         this.#requests.set(id, finish);

         this.#request.send(
            JSON.stringify({
               ns,
               data: { id, query },
            })
         );
      });
   }

   public collection<T = any>(name: string): ICollectionRef<T> {
      return new CollectionRef(this, [name]);
   }

   public async collections(): Promise<ICollectionRef[]> {
      return this[QueryRequest]({
         type: "list",
         path: [],
      }).then((res) => res.map((elm: any) => new CollectionRef(this, elm)));
   }

   public bulk(): IBulk {
      return new Bulk(this);
   }

   public async close() {
      this.#closedStore.send(true);
      this.#offlineStore.close();
      this.#request.close();
   }
}

class Query implements IQuery {
   private _limit: number | undefined;
   private _where: {
      fieldPath: FieldPath;
      opStr: WhereFilterOp;
      value: any;
   }[] = [];
   private _orderBy:
      | {
           fieldPath: FieldPath;
           direction: OrderByDirection;
        }
      | undefined;

   private _getNew() {
      let q = new Query(this.db, this.prefix);

      q._where = [...this._where];
      q._limit = this._limit;
      q._orderBy = this._orderBy;

      return q;
   }

   protected _getDocRef(id?: string): IDocumentRef<any> {
      return new DocumentRef(this.db, [...this.prefix, id || docNanoID()]);
   }

   public get database() {
      return this.db;
   }

   public get path() {
      return [...this.prefix];
   }

   constructor(protected db: Database, protected prefix: string[]) {}

   public where(
      fieldPath: FieldPath,
      opStr: WhereFilterOp,
      value: any
   ): IQuery {
      let q = this._getNew();
      q._where.push({ fieldPath, opStr, value });
      return q;
   }

   public orderBy(fieldPath: FieldPath, direction: OrderByDirection) {
      let q = this._getNew();
      q._orderBy = { fieldPath, direction };
      return q;
   }

   /**
    * WIP: the functionality is not stable yet!
    * @param limit The number of items
    */
   public limit(limit: number): IQuery {
      let q = this._getNew();
      q._limit = limit;
      return q;
   }

   private _getField(data: any, fieldpath: FieldPath) {
      let fields = fieldpath.split(".");
      let value = data;

      while (fields.length > 0) {
         if (!value) break;
         // @ts-ignore
         value = value[fields.shift()];
      }

      return value;
   }

   private _order(data: IDocumentSnapshot[]) {
      if (!this._orderBy) return data;

      data = data.sort((a, b) => {
         //@ts-ignore
         let val1 = this._getField(a.data(), this._orderBy.fieldPath);
         //@ts-ignore
         let val2 = this._getField(b.data(), this._orderBy.fieldPath);

         if (["number", "bigint", "boolean", "string"].indexOf(typeof val1) < 0)
            return 1;

         if (["number", "bigint", "boolean", "string"].indexOf(typeof val2) < 0)
            return 1;

         //TODO: Check how to resolve error without transpiler hacks

         //@ts-ignore
         return (val1 > val2) - (val2 > val1);
      });
      if (this._orderBy.direction === "desc") data = data.reverse();
      return data;
   }

   public async get(): Promise<IQuerySnapshot> {
      let data = this._order(
         (
            await this.db[QueryRequest]<DocRes[]>({
               type: "get",
               path: this.prefix,
               options: {
                  limit: this._limit,
                  where: this._where,
               },
            })
         ).map((e) => {
            return <IDocumentSnapshot>{
               id: e.id,
               data: () => e.data,
               ref: this._getDocRef(e.id),
            };
         })
      );

      return {
         docs: data,
         docChanges: () => {
            return data.map((doc) => {
               return <IDocumentChange>{
                  doc,
                  type: "added",
               };
            });
         },
         size: data.length,
         empty: data.length <= 0,
      };
   }

   static QuerySnapshot = class extends Snapshot<any> {
      private stored = new Map<string, IDocumentSnapshot>();
      constructor(
         private query: Query,
         private next: (
            err: Error | undefined,
            snapshot: IQuerySnapshot | undefined
         ) => void
      ) {
         super();
      }

      async subscribe() {
         this.query.database[Snapshots].set(this.id, this);
         await this.resubscribe();
         return () => this.unsubscribe();
      }

      public unsubscribe() {
         this.query.database[Snapshots].delete(this.id);
         return this.query.database[QueryRequest](
            {
               type: "unsubscribe",
               path: this.query.path,
            },
            this.id,
            "unsubscribe"
         );
      }

      private _change(changes: IDocumentChange[]) {
         let docs = Array.from(this.stored.values());
         docs = this.query._order(docs); //TODO: a little inefficient...

         this.next(undefined, {
            docs,
            docChanges: () => changes,
            empty: docs.length <= 0,
            size: docs.length,
         });
      }

      receivedData(data: (DocRes & { type: DocumentChangeType })[]) {
         let changes = data.map((raw) => {
            let doc = <IDocumentSnapshot>{
               id: raw.id,
               data: () => raw.data,
               ref: this.query._getDocRef(raw.id),
            };
            if (raw.type === "deleted") this.stored.delete(raw.id);
            else this.stored.set(raw.id, doc);
            return <IDocumentChange>{
               doc,
               type: raw.type,
            };
         });
         this._change(changes);
      }

      resubscribe() {
         if (this.isSubscribed) return;

         this.isSubscribed = true;
         return this.query.database[QueryRequest]<DocRes[]>(
            {
               type: "snapshot",
               options: {
                  where: this.query._where,
                  limit: this.query._limit,
               },
               path: this.query.path,
            },
            this.id,
            "snapshot"
         )
            .catch((err) => {
               this.query.database[Snapshots].delete(this.id);
               return Promise.reject(err);
            })
            .then((data) => {
               let newStored = new Map<string, IDocumentSnapshot>();
               let changes = data
                  .map((e) => {
                     let change = {
                        doc: {
                           id: e.id,
                           data: () => e.data,
                           ref: this.query._getDocRef(e.id),
                        },
                        type: "added",
                     };
                     newStored.set(change.doc.id, change.doc);
                     let old = this.stored.get(e.id);

                     if (old) {
                        this.stored.delete(change.doc.id);

                        if (isEqual(old, e.data)) {
                           return undefined;
                        } else {
                           change.type = "modified";
                        }
                     }
                     return change as IDocumentChange;
                  })
                  .filter((e) => !!e) as IDocumentChange[];

               changes = [
                  ...changes,
                  ...Array.from(this.stored.values()).map((stored) => {
                     stored.data = () => null;
                     return <IDocumentChange>{
                        doc: stored,
                        type: "deleted",
                     };
                  }),
               ];

               this.stored = newStored;

               this._change(changes);
            })
            .catch((err) => {
               if (!(err instanceof OfflineError)) {
                  this.next(err, undefined);
               }
               this.isSubscribed = false;
            });
      }

      destroy() {
         if (this.query.database[Snapshots].has(this.id)) {
            this.unsubscribe();
         }

         // @ts-ignore
         this.next = undefined;
         // @ts-ignore
         this.query = undefined;
         // @ts-ignore
         this.stored = undefined;
      }
   };

   async onSnapshot() {
      const asyncIter = new Utils.AsyncIteratorFromCB<any>();
      await new Query.QuerySnapshot(this, asyncIter.getCallback()).subscribe();
      return asyncIter;
   }
}

class CollectionRef extends Query implements ICollectionRef {
   get name() {
      return this.prefix[this.prefix.length - 1];
   }

   doc(id?: string): IDocumentRef {
      return this._getDocRef(id);
   }

   keys(): Promise<string[]> {
      return this.db[QueryRequest]({
         type: "keys",
         path: this.prefix,
      });
   }

   async add<T = any>(data: T): Promise<IDocumentRef<T>> {
      let id = await this.db[QueryRequest]({
         type: "add",
         path: this.prefix,
         data,
      });
      return new DocumentRef(this.db, [...this.prefix, id]);
   }

   delete() {
      return this.db[QueryRequest]({
         type: "delete-collection",
         path: this.prefix,
      });
   }
}

class DocumentRef implements IDocumentRef {
   constructor(private db: Database, private prefix: string[]) {}

   get id() {
      return this.prefix[this.prefix.length - 1];
   }

   public get database() {
      return this.db;
   }

   public get path() {
      return [...this.prefix];
   }

   get(): Promise<any> {
      return this.db[QueryRequest]({
         type: "get",
         path: this.prefix,
      });
   }

   _set(data: any): ITypedQuery<"set"> {
      return {
         type: "set",
         path: this.prefix,
         data,
      };
   }

   set(data: any): Promise<void> {
      return this.db[QueryRequest](this._set(data));
   }

   _update(update: DocumentUpdate): ITypedQuery<"update"> {
      let u = {} as any;
      for (const field in update) {
         const data = update[field];
         let res: { type: string; value?: any };
         if (typeof data === "object") {
            if (data[TimestampSymbol]) {
               res = {
                  type: "timestamp",
               };
            } else if (data[PushSymbol]) {
               res = {
                  type: "push",
                  value: data.value,
               };
            } else if (data[IncrementSymbol]) {
               res = {
                  type: "increment",
                  value: data.value,
               };
            } else {
               res = {
                  type: "value",
                  value: data,
               };
            }
         } else {
            res = {
               type: "value",
               value: data,
            };
         }

         u[field] = res;
      }

      return {
         type: "update",
         path: this.prefix,
         data: u,
      };
   }

   update(update: DocumentUpdate): Promise<void> {
      return this.db[QueryRequest](this._update(update));
   }

   _delete(): ITypedQuery<"delete"> {
      return {
         type: "delete",
         path: this.prefix,
      };
   }
   delete(): Promise<void> {
      return this.db[QueryRequest](this._delete());
   }

   static DocumentSnapshot = class extends Snapshot<any> {
      private stored = undefined;
      constructor(
         private document: DocumentRef,
         private next: (
            err: Error | undefined,
            snapshot: IDocumentSnapshot | undefined
         ) => void
      ) {
         super();
      }

      async subscribe() {
         this.document.database[Snapshots].set(this.id, this);
         await this.resubscribe();
         return () => this.unsubscribe();
      }

      public unsubscribe() {
         this.document.database[Snapshots].delete(this.id);
         return this.document.database[QueryRequest](
            {
               type: "unsubscribe",
               path: this.document.path,
            },
            this.id,
            "unsubscribe"
         );
      }

      private _change() {
         this.next(undefined, {
            id: this.document.id,
            data: () => this.stored,
            ref: this.document,
         });
      }

      receivedData(changes: Change[]) {
         changes.forEach((change) => {
            this.stored = change.data;
            this._change();
         });
      }

      resubscribe() {
         if (this.isSubscribed) return;
         this.isSubscribed = true;
         return this.document.database[QueryRequest]<any>(
            {
               type: "snapshot",
               path: this.document.path,
            },
            this.id,
            "snapshot"
         )
            .catch((err) => {
               this.document.database[Snapshots].delete(this.id);
               return Promise.reject(err);
            })
            .then((data) => {
               this.isSubscribed = true;
               if (!isEqual(this.stored, data)) {
                  this.stored = data;
                  this._change();
               }
            })
            .catch((err) => {
               if (!(err instanceof OfflineError)) {
                  this.next(err, undefined);
               }
               this.isSubscribed = false;
            });
      }

      destroy() {
         if (this.document.database[Snapshots].has(this.id)) {
            this.unsubscribe();
         }

         //@ts-ignore
         this.next = undefined;
         //@ts-ignore
         this.document = undefined;
         //@ts-ignore
         this.stored = undefined;
      }
   };

   async onSnapshot() {
      const asyncIter = new Utils.AsyncIteratorFromCB<IDocumentSnapshot>();

      await new DocumentRef.DocumentSnapshot(
         this,
         asyncIter.getCallback()
      ).subscribe();

      return asyncIter;
   }

   collection(name: string): ICollectionRef {
      return new CollectionRef(this.db, [...this.prefix, name]);
   }
}

class Bulk implements IBulk {
   constructor(private _database: Database) {}
   private _queries: ITypedQuery<"set" | "update" | "delete">[] = [];
   set(ref: DocumentRef, data: any) {
      this._queries.push(ref._set(data));
      return this;
   }

   update(ref: DocumentRef, updates: DocumentUpdate) {
      this._queries.push(ref._update(updates));
      return this;
   }

   delete(ref: DocumentRef) {
      this._queries.push(ref._delete());
      return this;
   }

   async commit() {
      if (this._queries.length > 0) {
         await this._database[QueryRequest](this._queries);
      }
   }
}
