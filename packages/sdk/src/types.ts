/**
 * The direction of a `Query.orderBy()` clause is specified as 'desc' or 'asc'
 * (descending or ascending).
 */
export type OrderByDirection = "desc" | "asc";

/**
 * Filter conditions in a `Query.where()` clause are specified using the
 * strings '<', '<=', '==', '>=', '>', 'array-contains', 'in', and 'array-contains-any'.
 */
export type WhereFilterOp = "<" | "<=" | "==" | ">=" | ">" | "array-contains";
// | 'in'
// | 'array-contains-any';

export type FieldPath = string;

export interface IQuery<T = any> {
   /**
    * Creates and returns a new Query with the additional filter that documents
    * must contain the specified field and the value should satisfy the
    * relation constraint provided.
    *
    * @param fieldPath The path to compare
    * @param opStr The operation string (e.g "<", "<=", "==", ">", ">=").
    * @param value The value for comparison
    * @return The created Query.
    */
   where(fieldPath: FieldPath, opStr: WhereFilterOp, value: any): IQuery<T>;

   orderBy(fieldPath: FieldPath, directionStr?: OrderByDirection): IQuery<T>;

   limit(limit: number): IQuery<T>;

   // limitToLast(limit: number): IQuery<T>;

   // startAt(snapshot: DocumentSnapshot): IQuery<T>;

   // startAt(...fieldValues: any[]): IQuery<T>;

   // startAfter(snapshot: DocumentSnapshot): IQuery<T>;

   // startAfter(...fieldValues: any[]): IQuery<T>;

   // endBefore(snapshot: DocumentSnapshot): IQuery<T>;

   // endBefore(...fieldValues: any[]): IQuery<T>;

   // endAt(snapshot: DocumentSnapshot): IQuery<T>;

   // endAt(...fieldValues: any[]): IQuery<T>;

   // /**
   //  * Returns true if this `Query` is equal to the provided one.
   //  *
   //  * @param other The `Query` to compare against.
   //  * @return true if this `Query` is equal to the provided one.
   //  */
   // isEqual(other: Query): boolean;

   get(): Promise<IQuerySnapshot<T>>;

   onSnapshot(): Promise<
      AsyncIterable<IQuerySnapshot<T>> & { close: () => void }
   >;
}

export interface ICollectionRef<U = any> extends IQuery<U> {
   readonly name: string;

   doc<T = U>(id?: string): IDocumentRef<T>;
   keys(): Promise<string[]>;
   add<T = U>(data: T): Promise<IDocumentRef<T>>;

   /**
    * Only if root key available
    */
   delete(): Promise<void>;
}

export const TimestampSymbol = Symbol("timestamp");
export const IncrementSymbol = Symbol("increment");
export const PushSymbol = Symbol("push");

export const UpdateTypes = {
   Value: (value: any) => value,
   Timestamp: { [TimestampSymbol]: true },
   Push: (value: any) => ({ [PushSymbol]: true, value }),
   Increment: (value: number) => ({ [IncrementSymbol]: true, value }),
};

export interface DocumentUpdate {
   [path: string]: any;
}

export interface IDocumentRef<T = any> {
   readonly id: string;

   get(): Promise<T>;
   set(data: T): Promise<void>;
   update(update: DocumentUpdate): Promise<void>;
   delete(): Promise<void>;

   onSnapshot(): Promise<
      AsyncIterable<IDocumentSnapshot<T>> & { close: () => void }
   >;

   collection<T>(name: string): ICollectionRef<T>;
}

export type DocumentChangeType = "added" | "modified" | "deleted";
export interface IDocumentChange<T = any> {
   readonly type: DocumentChangeType;
   readonly doc: IDocumentSnapshot<T>;
}

export interface IQuerySnapshot<T = any> {
   readonly docs: IDocumentSnapshot<T>[];
   readonly size: number;
   readonly empty: boolean;

   docChanges(): IDocumentChange<T>[];
}

export interface IDocumentSnapshot<T = any> {
   readonly id: string;

   readonly ref: IDocumentRef<T>;

   data(): T;
}

export interface IBulk {
   set(ref: IDocumentRef, data: any): IBulk;
   update(ref: IDocumentRef, updates: DocumentUpdate): IBulk;
   delete(ref: IDocumentRef): IBulk;
   commit(): Promise<any>;
}

// export type ISnapshotHandler<T> = IDocumentSnapshotHandler<T> | IQuerySnapshotHandler<T>;
