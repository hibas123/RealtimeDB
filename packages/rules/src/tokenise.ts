export type TokenTypes =
   | "space"
   | "comment"
   | "string"
   | "keyword"
   | "colon"
   | "semicolon"
   | "comma"
   | "comparison_operator"
   | "logic_operator"
   | "equals"
   | "slash"
   | "bracket_open"
   | "bracket_close"
   | "curly_open"
   | "curly_close"
   | "array"
   | "questionmark"
   | "number"
   | "text";

export type Token = {
   type: TokenTypes;
   value: string;
   startIdx: number;
   endIdx: number;
};

type Matcher = (input: string, index: number) => undefined | Token;

export class TokenizerError extends Error {
   index: number;
   constructor(message: string, index: number) {
      super(message);
      this.index = index;
   }
}

function regexMatcher(regex: string | RegExp, type: TokenTypes): Matcher {
   if (typeof regex === "string") regex = new RegExp(regex);

   return (input: string, index: number) => {
      let matches = input.substring(index).match(regex as RegExp);
      if (!matches || matches.length <= 0) return undefined;

      return {
         type,
         value: matches[0],
         startIdx: index,
         endIdx: index + matches[0].length,
      } as Token;
   };
}

const matcher = [
   regexMatcher(/^\s+/, "space"),
   regexMatcher(/^\/\/.+/, "comment"),
   regexMatcher(/^#.+/, "comment"),
   regexMatcher(/^".*?"/, "string"),
   // regexMatcher(/(?<=^")(.*?)(?=")/, "string"),
   regexMatcher(/^(service|match|allow|if|true|false|null)/, "keyword"),
   regexMatcher(/^\:/, "colon"),
   regexMatcher(/^\;/, "semicolon"),
   regexMatcher(/^\,/, "comma"),
   regexMatcher(/^(\=\=|\!\=|\<\=|\>\=|\>|\<)/, "comparison_operator"),
   regexMatcher(/^(&&|\|\|)/, "logic_operator"),
   regexMatcher(/^\=/, "equals"),
   regexMatcher(/^\//, "slash"),
   regexMatcher(/^\(/, "bracket_open"),
   regexMatcher(/^\)/, "bracket_close"),
   regexMatcher(/^{/, "curly_open"),
   regexMatcher(/^}/, "curly_close"),
   regexMatcher(/^\[\]/, "array"),
   regexMatcher(/^\?/, "questionmark"),
   regexMatcher(/^[0-9]+(\.[0-9]+)?/, "number"),
   regexMatcher(/^[a-zA-Z_\*]([a-zA-Z0-9_\.\*]?)+/, "text"),
];

export default function tokenize(input: string) {
   let index = 0;
   let tokens: Token[] = [];
   while (index < input.length) {
      const matches = matcher.map((m) => m(input, index)).filter((e) => !!e);
      let match = matches[0];
      if (match) {
         if (match.type !== "space" && match.type !== "comment") {
            tokens.push(match);
         }
         index += match.value.length;
      } else {
         throw new TokenizerError(
            `Unexpected token '${input.substring(index, index + 1)}'`,
            index
         );
      }
   }
   return tokens;
}
