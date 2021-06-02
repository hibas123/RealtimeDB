import { Operations } from "@hibas123/realtimedb-core";
import { Token } from "./tokenise";

export interface Node {
   type: string;
   idx: number;
}

export interface PathStatement extends Node {
   type: "path";
   segments: (string | { type: "variable"; name: string })[];
}

export interface ValueStatement extends Node {
   type: "value";
   isNull: boolean;
   isTrue: boolean;
   isFalse: boolean;
   isNumber: boolean;
   isString: boolean;
   isVariable: boolean;

   value?: any;
}

export type Operators = "&&" | "||" | "==" | "<=" | ">=" | "!=" | ">" | "<";

export interface Expression extends Node {
   type: "expression";

   left: ValueStatement | Expression;
   operator: Operators;
   right: ValueStatement | Expression;
}

export type { Operations };

// export type Operations = "read" | "write" | "list"; // | "update" | "create" | "delete" | "list";

export interface AllowStatement extends Node {
   type: "permission";
   operations: Operations[];
   condition: Expression | ValueStatement;
}

export interface MatchStatement extends Node {
   type: "match";
   path: PathStatement;
   matches: MatchStatement[];
   rules: AllowStatement[];
}

export interface ServiceStatement extends Node {
   type: "service";
   name: string;
   matches: MatchStatement[];
}

export class ParserError extends Error {
   token: Token;
   constructor(message: string, token: Token) {
      super(message);
      this.token = token;
   }
}

export default function parse(tokens: Token[]) {
   const tokenIterator = tokens[Symbol.iterator]();
   let currentToken: Token = tokenIterator.next().value;
   let nextToken: Token = tokenIterator.next().value;

   const eatToken = (value?: string) => {
      if (value && value !== currentToken.value) {
         throw new ParserError(
            `Unexpected token value, expected '${value}', received '${currentToken.value}'`,
            currentToken
         );
      }
      let idx = currentToken.startIdx;
      currentToken = nextToken;
      nextToken = tokenIterator.next().value;
      return idx;
   };

   const eatText = (): [string, number] => {
      checkTypes("text");
      let val = currentToken.value;
      let idx = currentToken.startIdx;
      eatToken();
      return [val, idx];
   };
   const eatNumber = (): number => {
      checkTypes("number");
      let val = Number(currentToken.value);
      if (Number.isNaN(val)) {
         throw new ParserError(
            `Value cannot be parsed as number! ${currentToken.value}`,
            currentToken
         );
      }
      eatToken();
      return val;
   };

   const checkTypes = (...types: string[]) => {
      if (types.indexOf(currentToken.type) < 0) {
         throw new ParserError(
            `Unexpected token value, expected ${types.join(" | ")}, received '${
               currentToken.value
            }'`,
            currentToken
         );
      }
   };

   const parsePathStatement = (): PathStatement => {
      const segments: (string | { name: string; type: "variable" })[] = [];
      const idx = currentToken.startIdx;
      let next = currentToken.type === "slash";
      while (next) {
         eatToken("/");
         if (currentToken.type === "curly_open" && nextToken.type === "text") {
            eatToken("{");
            const [name] = eatText();
            segments.push({
               type: "variable",
               name,
            });
            eatToken("}");
         } else if (currentToken.type === "text") {
            const [name] = eatText();
            segments.push(name);
         }
         next = currentToken.type === "slash";
      }

      return {
         type: "path",
         idx,
         segments,
      };
   };

   const parseValue = (): ValueStatement => {
      const idx = currentToken.startIdx;

      let isTrue = false;
      let isFalse = false;
      let isNull = false;
      let isVariable = false;
      let isNumber = false;
      let isString = false;
      let value: any = undefined;
      if (currentToken.type === "keyword") {
         if (currentToken.value === "true") isTrue = true;
         else if (currentToken.value === "false") isFalse = true;
         else if (currentToken.value === "null") isNull = true;
         else {
            throw new ParserError(
               `Invalid keyword at this position ${currentToken.value}`,
               currentToken
            );
         }
         eatToken();
      } else if (currentToken.type === "string") {
         isString = true;
         value = currentToken.value.slice(1, currentToken.value.length - 1);
         eatToken();
      } else if (currentToken.type === "number") {
         isNumber = true;
         value = eatNumber();
      } else if (currentToken.type === "text") {
         isVariable = true;
         [value] = eatText();
      } else {
         throw new ParserError(
            `Expected value got ${currentToken.type}`,
            currentToken
         );
      }

      return {
         type: "value",
         isFalse,
         isNull,
         isNumber,
         isString,
         isTrue,
         isVariable,
         value,
         idx,
      };
   };

   const parseCondition = (): Expression | ValueStatement => {
      // let running = true;
      let res: Expression | ValueStatement;
      let left: Expression | ValueStatement | undefined;

      // while (running) {
      const idx = currentToken.startIdx;

      if (!left) {
         if (currentToken.type === "bracket_open") {
            eatToken("(");
            left = parseCondition();
            eatToken(")");
         } else {
            left = parseValue();
         }
      }

      if (currentToken.type === "comparison_operator") {
         const operator = currentToken.value;

         eatToken();

         let right: Expression | ValueStatement;

         let ct = currentToken; //Quick hack because of TypeScript
         if (ct.type === "bracket_open") {
            eatToken("(");
            right = parseCondition();
            eatToken(")");
         } else {
            right = parseValue();
         }

         res = {
            type: "expression",
            left,
            right,
            operator: operator as Operators,
            idx,
         };
      } else if (currentToken.type === "logic_operator") {
         const operator = currentToken.value;

         eatToken();

         const right = parseCondition();

         res = {
            type: "expression",
            left,
            operator: operator as Operators,
            right,
            idx,
         };
      } else {
         res = left;
      }

      // let ct = currentToken;
      // if (
      //    ct.type === "comparison_operator" ||
      //    ct.type === "logic_operator"
      // ) {
      //    left = res;
      // } else {
      //    running = false;
      // }
      // }
      return res;
   };

   const parsePermissionStatement = (): AllowStatement => {
      const idx = eatToken("allow");

      const operations: Operations[] = [];
      let next = currentToken.type !== "colon";
      while (next) {
         const [operation] = eatText();
         operations.push(operation as Operations);
         if (currentToken.type === "comma") {
            next = true;
            eatToken(",");
         } else {
            next = false;
         }
      }

      eatToken(":");

      eatToken("if");

      const condition = parseCondition();

      eatToken(";");

      return {
         type: "permission",
         idx,
         operations,
         condition,
      };
   };

   const parseMatchStatement = (): MatchStatement => {
      const idx = eatToken("match");
      const path = parsePathStatement();

      eatToken("{");
      const matches: MatchStatement[] = [];
      const permissions: AllowStatement[] = [];
      while (currentToken.type !== "curly_close") {
         if (currentToken.value === "match") {
            matches.push(parseMatchStatement());
         } else if (currentToken.value === "allow") {
            permissions.push(parsePermissionStatement());
         } else {
            throw new ParserError(
               `Unexpected token value, expected 'match' or 'allow', received '${currentToken.value}'`,
               currentToken
            );
         }
      }
      eatToken("}");

      return {
         type: "match",
         path,
         idx,
         matches,
         rules: permissions,
      };
   };

   const parseServiceStatement = (): ServiceStatement => {
      const idx = eatToken("service");
      let [name] = eatText();
      eatToken("{");
      const matches: MatchStatement[] = [];
      while (currentToken.value === "match") {
         matches.push(parseMatchStatement());
      }
      eatToken("}");

      return {
         type: "service",
         name: name,
         idx,
         matches,
      };
   };

   const nodes: ServiceStatement[] = [];
   while (currentToken) {
      nodes.push(parseServiceStatement());
   }
   return nodes;
}
