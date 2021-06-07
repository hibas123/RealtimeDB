import Database from "@rtdb2/sdk";
import { testDB } from "@rtdb2/sdk/lib/tests";
import { EmbeddedConnector } from "./main";

const db = new Database(new EmbeddedConnector("./test"));

testDB(db);
