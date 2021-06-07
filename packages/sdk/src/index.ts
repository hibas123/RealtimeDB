// import * as WebSocket from "ws";

import Database from "./database";
export {
   IConnector,
   OfflineError,
   ICollectionQueries,
   IDocumentQueries,
   IWriteQueries,
   Change,
   ICallQueryTypes,
   IQueryRequest,
   Snapshot,
} from "./database";
export default Database;
export { Database };

export type {
   DocumentUpdate,
   OrderByDirection,
   WhereFilterOp,
   DocumentChangeType,
   IQuerySnapshot,
   FieldPath,
   ICollectionRef,
   IQuery,
   IDocumentChange,
   IDocumentRef,
   IDocumentSnapshot,
} from "./types";

export { UpdateTypes } from "./types";
