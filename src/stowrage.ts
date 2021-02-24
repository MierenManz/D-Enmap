import {
  IDNotFoundError,
  InvalidKeyError,
  KeyUndefinedError,
  NameDuplicationError,
  NameNotFoundError,
  nonPersistentError,
} from "./error.ts";

import * as fs from "./filesystem.ts";

// Import types from local typings.ts
import {
  ChangeValueOptions,
  DataBase,
  FilterFunc,
  StowrageOptions,
} from "./typings.ts";

import { DB } from "../deps.ts";

/**
* stowrage class
@property { number | undefined } maxEntries - max Entries in the Stowrage
@property { string | undefined } name - name of the Stowrage
@property { string } path - Directory for persistent data
@property { boolean | undefined } isPersistent - Enable or disable persistent storage
*/
export class Stowrage<DataType = unknown> {
  #id = 0;
  #SQLDB: DB | undefined;
  #IDMap = new Map<number, string>();
  #DB = new Map<string, DataBase<DataType>>();
  public maxEntries: number | undefined;
  public name: string | undefined;
  public path = "./stowrage/";
  public isPersistent: boolean | undefined = false;

  /**
  constructor
  @param { StowrageOptions } options - all start options for stowrage
  */
  public constructor(options?: StowrageOptions) {
    this.maxEntries = options?.maxEntries;
    this.name = options?.name;
    this.isPersistent = options?.persistent;
    if (this.name && !fs.pathExistSync(this.path)) Deno.mkdirSync(this.path);
    return;
  }

  /**
  Initiate persistent storage
  Throw's when `isPersistent` = false
  */
  public async init(): Promise<void> {
    if (this.name && this.isPersistent) {
      this.#SQLDB = new DB(this.path + this.name + ".db");
      this.#SQLDB.query(
        "CREATE TABLE IF NOT EXISTS stowrage (id INTEGER, name TEXT, data TEXT )",
      );
      for await (
        const [name, data] of this.#SQLDB.query(
          "SELECT name, data FROM stowrage",
        )
      ) {
        this.add(name, JSON.parse(data));
      }
    } else throw new nonPersistentError(this.name ?? "unnamed db", "initiated");
    return;
  }

  /**
  Add entry to db and returns it aswell
  @param { string } name - Name for the entry
  @param { DataType } value - Value that you want to store (Can be anything)
  @returns { DataBase<DataType> } Returns entry after it has been added
  */
  public ensure(name: string, value: DataType): DataBase<DataType> {
    if (this.#DB.has(name)) throw new NameDuplicationError(name);
    const entry = this.generateEntry(name, value);
    this.#IDMap.set(entry.id, name);
    this.#DB.set(name, entry);
    return entry;
  }

  /**
  Add entry to db
  @param { string } name - Name for the entry
  @param { DataType } value - Value that you want to store (Can be anything)
  */
  public add(name: string, key: DataType): void {
    if (this.#DB.has(name)) throw new NameDuplicationError(name);
    const entry = this.generateEntry(name, key);
    this.#IDMap.set(entry.id, name);
    this.#DB.set(name, entry);
    return;
  }

  /**
  Delete entry from db by name
  @param { string } name - Name of the entry you want to delete
  */
  public delete(name: string): void {
    const entry = this.#DB.get(name);
    if (!entry) throw new NameNotFoundError(name);
    this.#DB.delete(name);
    this.#IDMap.delete(entry.id);
    if (this.#SQLDB && this.isPersistent) {
      this.#SQLDB.query("DELETE FROM stowrage WHERE id = ?", [entry.id]);
    }
    return;
  }

  /**
  Delete entry from db by ID
  @param { number } id - ID of the entry you want to delete
  */
  public deleteByID(id: number): void {
    const name = this.#IDMap.get(id);
    if (!name) throw new IDNotFoundError(id);
    this.#IDMap.delete(id);
    this.#DB.delete(name);
    if (this.#SQLDB && this.isPersistent) {
      this.#SQLDB.query("DELETE FROM stowrage WHERE id = ?", [id]);
    }
    return;
  }

  /**
  Delete multiple entries from db
  @param { number } start - First entry you want to delete
  @param { number } length - Length to delete
  */
  public deleteByRange(start: number, length: number): void {
    const range = start + length;
    if (range >= this.#DB.size) {
      this.#DB.clear();
      this.#IDMap.clear();
      this.#id = 0;
      if (this.#SQLDB && this.isPersistent) {
        this.#SQLDB.query("DELETE FROM stowrage");
      }
    } else {
      this.#DB = new Map(
        [...this.#DB.entries()].filter((entry) =>
          entry[1].id < start || entry[1].id > range
        ),
      );
      this.#IDMap = new Map(
        [...this.#IDMap.entries()].filter((entry) =>
          entry[0] < start || entry[0] > range
        ),
      );
      if (this.#SQLDB && this.isPersistent) {
        this.#SQLDB.query("DELETE FROM stowrage WHERE id BETWEEN ? AND ?", [
          start,
          range,
        ]);
      }
    }
    return;
  }

  /**
  Override entry from db by name
  @param { string } name - Name of the entry you want to delete
  @param { DataType } newValue - New value you want to store
  */
  public override(name: string, newValue: DataType): void {
    if (!this.#DB.has(name)) throw new NameNotFoundError(name);
    const entry: DataBase<DataType> = this.generateEntry(name, newValue, true);
    this.#DB.set(name, entry);
    if (this.#SQLDB && this.isPersistent) {
      this.#SQLDB.query(
        "REPLACE INTO stowrage (id, name, data) VALUES(?, ?, ?)",
        [entry.id, entry.name, JSON.stringify(entry.data)],
      );
    }
    return;
  }

  /**
  Override entry from db by name
  @param { string } name - Name of the entry you want to delete
  @param { DataType } newValue - New value you want to store
  */
  public overrideByID(id: number, key: DataType): void {
    const name: string | undefined = this.#IDMap.get(id);
    if (name) {
      this.override(name, key);
    } else {
      throw new IDNotFoundError(id);
    }
    return;
  }

  /**
  Get an Array of entries that matches your filter
  @param { FilterFunc<DataType> } func - FilterFunction
  @returns { DataBase<DataType>[] } - Returns Array with filtered entries
  */
  public filter(func: FilterFunc<DataType>): DataBase<DataType>[] {
    return [...this.#DB.values()].filter(func);
  }

  /**
  Get the first entry that matches your filter
  @param { FilterFunc<DataType> } func - FilterFunction
  @returns { DataBase<DataType> | undefined } - Returns first match found or undefined if no match is found
  */
  public find(func: FilterFunc<DataType>): DataBase<DataType> | undefined {
    return [...this.#DB.values()].find(func);
  }

  /**
  Fetch entry by name
  @param { string } name - Name of the entry you want to fetch
  @returns { DataBase<DataType> } - Returns the entry that matches the name or throws
  */
  public fetch(name: string): DataBase<DataType> {
    const data = this.#DB.get(name);
    if (!data) throw new NameNotFoundError(name);
    return data;
  }

  /**
  Fetch entry by ID
  @param { number } id - ID of the entry you want to fetch
  @returns { DataBase<DataType> } - Returns the entry that matches the ID or throws
  */
  public fetchByID(id: number): DataBase<DataType> {
    const name: string | undefined = this.#IDMap.get(id);
    if (!name) throw new IDNotFoundError(id);
    return this.fetch(name);
  }

  /**
  Fetch multiple entries from db
  @param { number } start - First entry you want to fetch
  @param { number } length - Length to fetch
  @returns { DataBase<DataType>[] } - Returns Array 
  */
  public fetchByRange(start: number, length: number): DataBase<DataType>[] {
    const range = start + length;
    if (range >= this.#DB.size) return [...this.#DB.values()];
    return [...this.#DB.values()].filter((data) =>
      data.id >= start && data.id < range
    );
  }

  /**
  Set the value of an entry via ID
  @param { number } id - ID of the entry to change value of
  @param { ChangeValueOptions<unknown> } options - Extra options like key and value
  */
  public setValue(id: number, options: ChangeValueOptions<unknown>): void;

  /**
  Set the value of an entry via ID
  @param { string } name - Name of the entry to change value of
  @param { ChangeValueOptions<unknown> } options - Extra options like key and value
  */
  public setValue(name: string, options: ChangeValueOptions<unknown>): void;
  public setValue(
    nameID: string | number,
    options: ChangeValueOptions<unknown>,
  ): void {
    if (typeof nameID === "number") nameID = this.#IDMap.get(nameID)!;
    if (!nameID) {
      if (typeof nameID === "string") throw new NameNotFoundError(nameID);
      else throw new IDNotFoundError(nameID);
    }
    const entry = this.#DB.get(nameID);
    if (typeof entry!.data === "object") {
      if (typeof options.key === "undefined") throw new KeyUndefinedError();
      if (
        typeof (entry!.data as Record<string, DataType>)[options.key] ===
          "undefined"
      ) {
        throw new InvalidKeyError(options.key, this.name ?? "unnamed db");
      }
      (entry!.data as Record<string, unknown>)[options.key] = options.value;
    } else {
      (entry!.data as unknown) = options.value;
    }
    this.override(nameID, entry!.data as DataType);
    return;
  }

  /**
  Check if your stowrage has an entry with the given name
  @param { string } searchName - Name to look for
  @returns { boolean } - Returns true or false
  */
  public has(name: string): boolean {
    return this.#DB.has(name);
  }

  public deleteStowrage(): void {
    this.#DB.clear();
    this.#IDMap.clear();
    this.#id = 0;
    if (this.isPersistent && this.#SQLDB) {
      this.#SQLDB.query("DELETE FROM stowrage");
    }
    return;
  }

  /**
  Close SQLite database if it exists
  */
  public close(): void {
    if (!this.#SQLDB) {
      throw new nonPersistentError(this.name ?? "unnamed db", "closed");
    }
    this.#SQLDB.close();
    return;
  }

  /**
  Get total entries of the Stowrage
  */
  public totalEntries(): number {
    return this.#DB.size;
  }

  private generateEntry(
    name: string,
    key: DataType,
    override?: boolean,
  ): DataBase<DataType> {
    let id: number;
    if (override) {
      id = this.#DB.get(name)!.id;
    } else {
      id = this.#id++;
    }
    const obj: DataBase<DataType> = {
      id: id,
      name: name,
      data: key,
    };
    if (!override) {
      if (this.#SQLDB && this.isPersistent) {
        this.#SQLDB.query(
          "INSERT INTO stowrage (id, name, data) VALUES(?, ?, ?)",
          [obj.id, obj.name, JSON.stringify(obj.data)],
        );
      }
      if (this.maxEntries && this.#DB.size > this.maxEntries) {
        const name = this.#IDMap.get(this.#id - this.maxEntries);
        if (name) this.#DB.delete(name);
        if (this.#SQLDB && this.isPersistent) {
          this.#SQLDB.query("DELETE FROM stowrage WHERE name = ?", [name]);
        }
      }
    }
    return obj;
  }
}
