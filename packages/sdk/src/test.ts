import DB from "./index";
import { testDB } from "./tests";

const db = new DB(
   "http://localhost:5000",
   "test_database",
   "access87125t487123897458725123",
   undefined,
   "root12341213312312365465as4df6"
);

testDB(db);
