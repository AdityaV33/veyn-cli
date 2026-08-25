import { ScannedFile } from "../scanner/index.js";

export interface FileChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}
