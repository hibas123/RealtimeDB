import { IRuleEngine } from "@rtdb2/-core";

import { RuleError, transformError } from "./error";
import parse, { ParserError } from "./parser";
import tokenize, { TokenizerError } from "./tokenise";
import { getRuleRunner, RuleRunner } from "./compile";

export type { RuleError };

export default function compileRule(rule: string) {
   let runner: IRuleEngine | undefined;
   let error: RuleError | undefined;
   try {
      const tokenised = tokenize(rule);
      const parsed = parse(tokenised);
      const dbservice = parsed.find((e) => e.name === "realtimedb");

      if (!dbservice) throw new Error("No realtimedb service available!");

      runner = getRuleRunner(dbservice);
   } catch (err) {
      if (err instanceof TokenizerError) {
         error = transformError(err, rule, err.index);
      } else if (err instanceof ParserError) {
         error = transformError(err, rule, err.token.startIdx);
      } else {
         throw err;
      }
   }

   return { runner, error };
}
