// @types/node 20 has no typings for the built-in node:sqlite module (Node >= 22.13).
// This declares only the members the event log uses. Remove it when @types/node is upgraded to
// a version that ships node:sqlite typings; two declarations of the module would conflict.
declare module 'node:sqlite' {
  export type SQLInputValue = string | number | bigint | null | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...params: SQLInputValue[]): Array<Record<string, unknown>>;
    get(...params: SQLInputValue[]): Record<string, unknown> | undefined;
    run(...params: SQLInputValue[]): StatementResultingChanges;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
