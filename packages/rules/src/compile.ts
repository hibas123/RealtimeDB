import { IRuleEngine } from "@rtdb2/-core";

import {
   Node,
   MatchStatement,
   Operations,
   ServiceStatement,
   Expression,
   ValueStatement,
   Operators,
} from "./parser";

export class CompilerError extends Error {
   node: Node;
   constructor(message: string, node: Node) {
      super(message);
      this.node = node;
   }
}

type Variables = { [key: string]: string | Variables };

class Variable {
   #name: string;
   constructor(name: string) {
      this.#name = name;
   }

   getValue(variables: Variables) {
      const parts = this.#name.split(".");
      let current = variables as any;
      while (parts.length > 0) {
         const name = parts.shift();
         if (current && typeof current == "object") current = current[name];
      }
      return current;
   }
}

class Value {
   #value: any;
   constructor(value: any) {
      this.#value = value;
   }

   get value() {
      return this.#value;
   }
}

type ConditionParameters = Value | ConditionMatcher | Variable;
class ConditionMatcher {
   #left: ConditionParameters;
   #right: ConditionParameters;
   #operator: Operators;
   constructor(
      left: ConditionParameters,
      right: ConditionParameters,
      operator: Operators
   ) {
      this.#left = left;
      this.#right = right;
      this.#operator = operator;
   }

   test(variables: Variables): boolean {
      let leftValue: any;
      if (this.#left instanceof Value) {
         leftValue = this.#left.value;
      } else if (this.#left instanceof Variable) {
         leftValue = this.#left.getValue(variables);
      } else {
         leftValue = this.#left.test(variables);
      }

      let rightValue: any;
      if (this.#right instanceof Value) {
         rightValue = this.#right.value;
      } else if (this.#right instanceof Variable) {
         rightValue = this.#right.getValue(variables);
      } else {
         rightValue = this.#right.test(variables);
      }

      switch (this.#operator) {
         case "==":
            return leftValue == rightValue;
         case "!=":
            return leftValue != rightValue;
         case ">=":
            return leftValue >= rightValue;
         case "<=":
            return leftValue <= rightValue;
         case ">":
            return leftValue > rightValue;
         case "<":
            return leftValue < rightValue;
         case "&&":
            return leftValue && rightValue;
         case "||":
            return leftValue || rightValue;
         default:
            throw new Error("Invalid operator " + this.#operator);
      }
   }
}

class Rule {
   #operation: Operations;

   #condition: ConditionParameters;

   get operation() {
      return this.#operation;
   }

   constructor(operation: Operations, condition: ConditionParameters) {
      this.#operation = operation;
      this.#condition = condition;
   }

   test(variables: Variables): boolean {
      if (this.#condition instanceof Value) {
         return Boolean(this.#condition.value);
      } else if (this.#condition instanceof Variable) {
         return Boolean(this.#condition.getValue(variables));
      } else {
         return this.#condition.test(variables);
      }
   }
}

class Segment {
   #name: string;
   #variable: boolean;
   get name() {
      return this.#name;
   }
   constructor(name: string, variable = false) {
      this.#name = name;
      this.#variable = variable;
   }

   match(segment: string): { match: boolean; variable?: string } {
      return {
         match: this.#name === segment || this.#variable,
         variable: this.#variable && this.#name,
      };
   }
}

class Match {
   #submatches: Match[];
   #rules: Rule[];

   #segments: Segment[];
   #wildcard: boolean;

   constructor(
      segments: Segment[],
      rules: Rule[],
      wildcard: boolean,
      submatches: Match[]
   ) {
      this.#segments = segments;
      this.#rules = rules;
      this.#wildcard = wildcard;
      this.#submatches = submatches;
   }

   match(
      segments: string[],
      operation: Operations,
      variables: Variables
   ): boolean {
      let localVars = { ...variables };
      if (segments.length >= this.#segments.length) {
         for (let i = 0; i < this.#segments.length; i++) {
            const match = this.#segments[i].match(segments[i]);
            if (match.match) {
               if (match.variable) {
                  localVars[match.variable] = segments[i];
               }
            } else {
               return false;
            }
         }
         let remaining = segments.slice(this.#segments.length);
         if (remaining.length > 0 && !this.#wildcard) {
            for (const match of this.#submatches) {
               const res = match.match(remaining, operation, localVars);
               if (res) return true;
            }
         } else {
            for (const rule of this.#rules) {
               if (rule.operation === operation) {
                  if (rule.test(localVars)) return true;
               }
            }
         }
      }

      return false;
   }
}

export class RuleRunner implements IRuleEngine {
   #root_matches: Match[];
   constructor(root_matches: Match[]) {
      this.#root_matches = root_matches;
   }

   hasPermission(path: string[], operation: Operations, request: any): boolean {
      if (request.root) return true;
      for (const match of this.#root_matches) {
         const res = match.match(path, operation, { request });
         if (res) return true;
      }
      return false;
   }
}

export function getRuleRunner(service: ServiceStatement) {
   const createMatch = (s_match: MatchStatement) => {
      let wildcard = false;
      let segments = s_match.path.segments
         .map((segment, idx, arr) => {
            if (typeof segment === "string") {
               if (segment === "*") {
                  if (idx === arr.length - 1) {
                     wildcard = true;
                     return null;
                  } else {
                     throw new CompilerError("Invalid path wildcard!", s_match);
                  }
               } else {
                  return new Segment(segment, false);
               }
            } else {
               return new Segment(segment.name, true);
            }
         })
         .filter((e) => e !== null);

      const resolveParameter = (e: Expression | ValueStatement) => {
         let val: Value | ConditionMatcher | Variable;
         if (e.type === "value") {
            const c = e;
            if (c.isFalse) {
               val = new Value(false);
            } else if (c.isTrue) {
               val = new Value(true);
            } else if (c.isNull) {
               val = new Value(null);
            } else if (c.isNumber) {
               val = new Value(Number(c.value));
            } else if (c.isString) {
               val = new Value(String(c.value));
            } else if (c.isVariable) {
               val = new Variable(String(c.value));
            } else {
               throw new CompilerError("Invalid value type!", e);
            }
         } else {
            val = createCondition(e);
         }

         return val;
      };

      const createCondition = (cond: Expression): ConditionMatcher => {
         let left: ConditionParameters = resolveParameter(cond.left);
         let right: ConditionParameters = resolveParameter(cond.right);

         return new ConditionMatcher(left, right, cond.operator);
      };

      const rules: Rule[] = s_match.rules
         .map((rule) => {
            const condition = resolveParameter(rule.condition);
            return rule.operations.map((op) => new Rule(op, condition));
         })
         .flat(1);
      const submatches = s_match.matches.map((sub) => createMatch(sub));
      const match = new Match(segments, rules, wildcard, submatches);

      return match;
   };

   const root_matches = service.matches.map((match) => createMatch(match));

   const runner = new RuleRunner(root_matches);

   return runner;
}
