const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn, exec } = require("child_process");

/** * ============================================================
 * THE FULL VEXAL MANUAL (v10.2.2 - COMPILER PATCHED)
 * ============================================================
 */
const VEXAL_DOCS = [
  `[DOCS: VARIABLES & SYNTAX]
* syntax error: variable must be a quoted string
* const-
  fr 'name' is value
  fr this 'name' is value
* let-
  this 'name' is value`,

  `[DOCS: LOOPS & MATH]
* for loop-
  loop! [counter] { code }
* math-
  debug! (1+1) 
  (Math MUST be in parentheses)`,

  `[DOCS: TYPES & AUTOSTATUS]
* "value"        -> :str
* value:str      -> :str
* value          -> :str (by autostatus)
* 1              -> :str (by autostatus)
* 1:num          -> :num`,
];

/** * ============================================================
 * SECTION 1: THE LEXER
 * ============================================================
 */
function lexer(input) {
  const tokens = [];
  let cursor = 0;
  let line = 1;

  while (cursor < input.length) {
    let char = input[cursor];

    if (char === "\n") {
      line++;
      cursor++;
      continue;
    }
    if (/\s/.test(char)) {
      cursor++;
      continue;
    }

    if (char === "/" && input[cursor + 1] === "/") {
      while (cursor < input.length && input[cursor] !== "\n") cursor++;
      continue;
    }

    if (char === '"' || char === "'") {
      let quote = char;
      let value = "";
      cursor++;
      while (cursor < input.length && input[cursor] !== quote) {
        value += input[cursor];
        cursor++;
      }
      cursor++;
      tokens.push({ type: "string", value, line });
      continue;
    }

    if (/[0-9]/.test(char)) {
      let value = "";
      while (cursor < input.length && /[0-9.]/.test(input[cursor])) {
        value += input[cursor];
        cursor++;
      }
      tokens.push({ type: "number", value, line });
      continue;
    }

    if (/[a-z_]/i.test(char)) {
      let value = "";
      while (cursor < input.length && /[a-z0-9_!:]/i.test(input[cursor])) {
        value += input[cursor];
        cursor++;
      }
      if (value === "yup") tokens.push({ type: "boolean", value: true, line });
      else if (value === "nah")
        tokens.push({ type: "boolean", value: false, line });
      else if (value === "null")
        tokens.push({ type: "null", value: null, line });
      else if (value === "undefined")
        tokens.push({ type: "undefined", value: undefined, line });
      else if (value === "random") tokens.push({ type: "random", value, line });
      else if (value === "bussin") tokens.push({ type: "bussin", value, line });
      else tokens.push({ type: "name", value, line });
      continue;
    }

    if ("(){},><.+-*/!{}:=[]".includes(char)) {
      tokens.push({ type: "symbol", value: char, line });
      cursor++;
      continue;
    }

    throw new Error(
      `[SyntaxError] Unknown character '${char}' at line ${line}`
    );
  }
  return tokens;
}

/** * ============================================================
 * SECTION 2: THE PARSER
 * ============================================================
 */
const STOP_KEYWORDS = [
  "set",
  "fr",
  "this",
  "if",
  "elseif",
  "loop",
  "cut",
  "banish",
  "bussin",
  "debug",
  "openfile",
  "vx",
];

function parser(tokens) {
  let current = 0;
  function peek() {
    return tokens[current];
  }
  function peekNext() {
    return tokens[current + 1];
  }

  function buildSmartNode(parts) {
    if (parts.length === 0) return { type: "StringLiteral", value: "" };
    if (parts.length === 1) return parts[0];
    return { type: "SmartPhrase", parts };
  }

  function walkPhrase() {
    let parts = [];
    let first = walk(true);
    if (!first) return null;
    if (
      [
        "BinaryExpression",
        "RandomExpression",
        "Comparison",
        "BooleanLiteral",
      ].includes(first.type)
    ) {
      return first;
    }
    parts.push(first);
    while (current < tokens.length) {
      let nextTok = peek();
      if (!nextTok) break;
      if (
        nextTok.type === "symbol" &&
        [",", "}", "]", ")", "{"].includes(nextTok.value)
      )
        break;
      if (nextTok.type === "name" && STOP_KEYWORDS.includes(nextTok.value))
        break;
      if (nextTok.value === "is" || nextTok.value === "=") break;
      let part = walk(true);
      if (part) parts.push(part);
      else break;
    }
    return buildSmartNode(parts);
  }

  function walk(insidePhrase = false) {
    let token = tokens[current];
    if (!token) return null;

    if (peekNext() && peekNext().value === ":") {
      let valNode = null;
      if (token.type === "number")
        valNode = { type: "NumberLiteral", value: parseFloat(token.value) };
      else if (token.type === "string")
        valNode = { type: "StringLiteral", value: token.value };
      else if (token.type === "boolean")
        valNode = { type: "BooleanLiteral", value: token.value };
      else if (token.type === "name")
        valNode = { type: "Identifier", name: token.value };

      if (valNode) {
        current += 2;
        let statusToken = tokens[current];
        if (statusToken && statusToken.type === "name") {
          current++;
          return {
            type: "CastExpression",
            value: valNode,
            status: statusToken.value,
          };
        } else current -= 2;
      }
    }

    if (token.type === "number") {
      current++;
      return { type: "NumberLiteral", value: parseFloat(token.value) };
    }
    if (token.type === "string") {
      current++;
      return { type: "StringLiteral", value: token.value };
    }
    if (token.type === "boolean") {
      current++;
      return { type: "BooleanLiteral", value: token.value };
    }
    if (token.type === "null") {
      current++;
      return { type: "NullLiteral", value: null };
    }
    if (token.type === "undefined") {
      current++;
      return { type: "UndefinedLiteral", value: undefined };
    }
    if (token.type === "bussin") {
      current++;
      return { type: "BussinStatement" };
    }

    if (token.type === "symbol") {
      if (token.value === "(") {
        current++;
        let left = walk();
        let operator = tokens[current] ? tokens[current].value : null;
        if (operator === "is" || operator === "=") {
          current++;
          let right = walk();
          if (peek() && peek().value === ")") current++;
          return { type: "Comparison", left, right };
        }
        if (operator && "+-*/".includes(operator)) {
          current++;
          let right = walk();
          if (peek() && peek().value === ")") current++;
          return { type: "BinaryExpression", left, operator, right };
        }
        if (peek() && peek().value === ")") current++;
        return left;
      }
      if (!["{", "}", "[", "]", "(", ")", ","].includes(token.value)) {
        current++;
        return { type: "StringLiteral", value: token.value };
      }
    }

    if (token.type === "random") {
      current++;
      return { type: "RandomExpression", min: walk(), max: walk() };
    }

    if (token.type === "name") {
      if (token.value === "vx" && !insidePhrase) {
        current++;
        return { type: "HelpCommand" };
      }
      if (token.value === "openfile" && !insidePhrase) {
        current++;
        return { type: "OpenFileCommand" };
      }

      if (token.value === "if" || token.value === "elseif") {
        let type = token.value === "if" ? "IfStatement" : "ElseIfStatement";
        current++;
        let condition = walk();
        if (peek() && (peek().value === "=" || peek().value === "is")) {
          current++;
          condition = { type: "Comparison", left: condition, right: walk() };
        }
        if (peek() && peek().value === "{") current++;
        let body = [];
        while (peek() && peek().value !== "}") {
          let node = walk();
          if (node) body.push(node);
          else current++;
        }
        current++;
        let alternate = null;
        if (peek() && peek().value === "elseif") alternate = walk();
        return { type, condition, body, alternate };
      }

      if (token.value === "fr" || token.value === "this") {
        let isConst = token.value === "fr";
        current++;
        if (isConst && peek() && peek().value === "this") current++;

        if (peek().type !== "string") {
          throw new Error("syntax error: variable must be a quoted string");
        }

        let name = tokens[current].value;
        current++;
        if (peek() && (peek().value === "is" || peek().value === "="))
          current++;
        return {
          type: "VariableDeclaration",
          name,
          value: walkPhrase(),
          isConstant: isConst,
        };
      }

      if (token.value === "set") {
        current++;
        if (peek().type !== "string")
          throw new Error("syntax error: variable must be a quoted string");
        let name = tokens[current].value;
        current++;
        if (peek() && (peek().value === "is" || peek().value === "="))
          current++;
        return { type: "Assignment", name, value: walkPhrase() };
      }

      if (token.value.endsWith("!")) {
        let name = token.value.replace("!", "");
        if (name === "loop") {
          current++;
          let times = null;
          if (peek() && peek().value === "[") {
            current++;
            times = walk();
            if (peek() && peek().value === "]") current++;
          }
          if (peek() && peek().value === "{") {
            current++;
            let body = [];
            while (peek() && peek().value !== "}") {
              let node = walk();
              if (node) body.push(node);
              else current++;
            }
            current++;
            return { type: "LoopStatement", body, times };
          }
        }
        if (name === "cut") {
          current++;
          let next = peek();
          if (next && next.type === "string") {
            let rawTarget = next.value;
            current++;
            return { type: "CutCommand", rawTarget, mode: "modify" };
          } else {
            return { type: "CutCommand", mode: "toggle" };
          }
        }
        if (name === "banish") {
          current++;
          if (peek().type !== "string")
            throw new Error("Target for banish! must be a quoted string");
          let rawTarget = tokens[current].value;
          current++;
          return { type: "BanishCommand", rawTarget };
        }
        current++;
        let params = [];
        while (peek() && !["}", "]", ")"].includes(peek().value)) {
          if (STOP_KEYWORDS.includes(peek().value)) break;
          if (peek().value === ",") {
            current++;
            continue;
          }
          let paramNode = walkPhrase();
          if (paramNode) params.push(paramNode);
          else current++;
        }
        return { type: "CallExpression", name, params };
      }

      let rawName = token.value;
      if (rawName.includes(":")) {
        let parts = rawName.split(":");
        return {
          type: "CastExpression",
          value: { type: "Identifier", name: parts[0] },
          status: parts[1],
        };
      }
      current++;
      return { type: "Identifier", name: rawName };
    }
    return null;
  }

  let ast = { type: "Program", body: [] };
  while (current < tokens.length) {
    let node = walk();
    if (node) ast.body.push(node);
    else current++;
  }
  return ast;
}

/** * ============================================================
 * SECTION 3: THE TRANSCRIBER (COMPILER PATCHED)
 * ============================================================
 */
function compile(ast) {
  let output = `
// --- COMPILED VEXAL JS ---
const _vexHelper = {
  cast: (val, type) => {
    if (!type) return val;
    if (type === 'num') return Number(val);
    if (type === 'str') return String(val);
    if (type === 'bool') return Boolean(val);
    if (type === 'var') return val;
    return val;
  },
  autoStatus: (val) => {
    if (typeof val === 'number') return String(val);
    return val;
  },
  random: (min, max) => Math.floor(Math.random() * (max - min + 1) + min)
};

// --- USER CODE ---
`;

  function t(node, parentContext = null) {
    if (!node) return "";
    switch (node.type) {
      case "Program":
        return node.body.map((n) => t(n)).join("\n");

      case "VariableDeclaration":
        // Fix: If assigning a Loop or If statement, wrap in IIFE
        let valCode = t(node.value, "decl");
        if (["LoopStatement", "IfStatement"].includes(node.value.type)) {
          valCode = `(() => { ${valCode} })()`;
        }
        return `${node.isConstant ? "const" : "let"} ${
          node.name
        } = ${valCode};`;

      case "Assignment":
        let assignCode = t(node.value, "decl");
        if (["LoopStatement", "IfStatement"].includes(node.value.type)) {
          assignCode = `(() => { ${assignCode} })()`;
        }
        return `${node.name} = ${assignCode};`;

      case "CallExpression":
        if (node.name === "debug")
          return `console.log(${node.params
            .map((n) => t(n, "call"))
            .join(", ")});`;
        return `${node.name}(${node.params
          .map((n) => t(n, "call"))
          .join(", ")});`;

      case "BussinStatement":
        return `process.exit(0);`;

      case "LoopStatement":
        if (node.times) {
          return `for(let i=0; i<Number(${t(
            node.times,
            "math"
          )}); i++) {\n${node.body.map((n) => t(n)).join("\n")}\n}`;
        } else {
          return `while(true) {\n${node.body.map((n) => t(n)).join("\n")}\n}`;
        }

      case "IfStatement":
        let code = `if (${t(node.condition, "math")}) {\n${node.body
          .map((n) => t(n))
          .join("\n")}\n}`;
        if (node.alternate) code += ` else {\n${t(node.alternate)}\n}`;
        return code;

      case "Comparison":
        return `${t(node.left, "math")} === ${t(node.right, "math")}`;

      case "BinaryExpression":
        return `(${t(node.left, "math")} ${node.operator} ${t(
          node.right,
          "math"
        )})`;

      case "RandomExpression":
        return `_vexHelper.random(${t(node.min, "math")}, ${t(
          node.max,
          "math"
        )})`;

      case "SmartPhrase":
        return `[${node.parts
          .map((n) => t(n, parentContext))
          .join(", ")}].join(" ")`;

      case "CastExpression":
        if (node.status === "var") return t(node.value);
        return `_vexHelper.cast(${t(node.value, "cast")}, "${node.status}")`;

      case "BanishCommand":
        return `${node.rawTarget} = undefined;`;
      case "CutCommand":
        return `// cut! ignored in compiled`;

      // --- PRIMITIVES & AUTOSTATUS ---
      case "NumberLiteral":
        if (parentContext === "decl" || parentContext === "call")
          return `"${node.value}"`;
        if (parentContext === "math" || parentContext === "cast")
          return node.value;
        return `"${node.value}"`;

      case "StringLiteral":
        return `"${node.value}"`;
      case "BooleanLiteral":
        return node.value;
      case "NullLiteral":
        return "null";
      case "UndefinedLiteral":
        return "undefined";
      case "Identifier":
        return node.name;

      default:
        return `// Unknown: ${node.type}`;
    }
  }

  output += t(ast);
  return output;
}

/** * ============================================================
 * SECTION 4: THE INTERPRETER
 * ============================================================
 */
function applyStatus(val, status) {
  if (!status) return val;
  switch (status) {
    case "num":
      return parseFloat(val);
    case "str":
      return String(val);
    case "bool":
      return val === "yup" || val === true || val === "true" || val === 1;
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "var":
      return val;
    default:
      return val;
  }
}

function checkType(val, reqType) {
  if (!reqType) return true;
  if (reqType === "num" && typeof val !== "number") return false;
  if (reqType === "str" && typeof val !== "string") return false;
  if (reqType === "bool" && typeof val !== "boolean") return false;
  return true;
}

function interpreter(node, env) {
  if (!node) return;

  switch (node.type) {
    case "Program":
      node.body.forEach((s) => interpreter(s, env));
      return;
    case "BussinStatement":
      console.log("Bussin. Exiting...");
      process.exit(0);
    case "OpenFileCommand":
      promptForFile();
      throw new Error("CMD_INTERRUPT");
    case "HelpCommand":
      console.log("\n=== VEXAL MANUAL ===");
      VEXAL_DOCS.forEach((d) => console.log(d + "\n------------------"));
      return;

    case "SmartPhrase":
      const evaluatedParts = node.parts.map((part) => {
        let val = interpreter(part, env);
        if (part.type === "NumberLiteral") return String(val);
        return val;
      });
      return evaluatedParts.join(" ");

    case "CastExpression": {
      let innerVal = interpreter(node.value, env);
      if (node.status === "var") {
        let key = String(innerVal);
        return env.values.hasOwnProperty(key) ? env.values[key] : undefined;
      }
      return applyStatus(innerVal, node.status);
    }

    case "VariableDeclaration": {
      let varName = node.name;
      let initVal = interpreter(node.value, env);
      if (node.value.type === "NumberLiteral") initVal = String(initVal);
      env.values[varName] = initVal;
      if (node.isConstant) env.constants.add(varName);
      return;
    }

    case "Assignment": {
      let targetName = node.name;
      if (!env.values.hasOwnProperty(targetName))
        throw new Error(`[ReferenceError] '${targetName}' undefined.`);
      if (env.constants.has(targetName))
        throw new Error(`[Error] '${targetName}' is fr (constant).`);
      let assignVal = interpreter(node.value, env);
      if (node.value.type === "NumberLiteral") assignVal = String(assignVal);
      env.values[targetName] = assignVal;
      return;
    }

    case "CutCommand": {
      if (node.mode === "toggle") {
        env.autoStatus = !env.autoStatus;
        console.log(
          `[System] AutoStatus is now: ${env.autoStatus ? "ON" : "OFF"}`
        );
      } else {
        let name = node.rawTarget;
        if (env.constants.has(name)) env.constants.delete(name);
      }
      return;
    }

    case "BanishCommand": {
      let name = node.rawTarget;
      if (env.values.hasOwnProperty(name)) {
        delete env.values[name];
        env.constants.delete(name);
      }
      return;
    }

    case "Identifier": {
      if (node.name === "undefined") return undefined;
      if (node.name === "null") return null;
      throw new Error(
        `[SyntaxError] Unknown identifier '${node.name}'. Variables must be quoted.`
      );
    }

    case "CallExpression": {
      if (node.name === "debug") {
        node.params.forEach((param) => {
          let val = interpreter(param, env);
          if (param.type === "NumberLiteral") val = String(val);
          console.log(val);
        });
        return;
      }
      node.params.forEach((p) => interpreter(p, env));
      return;
    }

    case "LoopStatement": {
      if (node.times) {
        const limit = Number(interpreter(node.times, env));
        for (let i = 0; i < limit; i++)
          node.body.forEach((s) => interpreter(s, env));
      } else {
        while (true) node.body.forEach((s) => interpreter(s, env));
      }
      return;
    }

    case "IfStatement": {
      let cond = interpreter(node.condition, env);
      if (cond === true || cond === "yup")
        node.body.forEach((s) => interpreter(s, env));
      else if (node.alternate) interpreter(node.alternate, env);
      return;
    }

    case "Comparison":
      return interpreter(node.left, env) === interpreter(node.right, env);
    case "BinaryExpression": {
      const l = interpreter(node.left, env);
      const r = interpreter(node.right, env);
      if (node.operator === "+") return l + r;
      if (node.operator === "-") return l - r;
      if (node.operator === "*") return l * r;
      if (node.operator === "/") return l / r;
      return 0;
    }
    case "NumberLiteral":
      return node.value;
    case "StringLiteral":
      return node.value;
    case "BooleanLiteral":
      return node.value;
    case "NullLiteral":
      return null;
    case "UndefinedLiteral":
      return undefined;
    case "RandomExpression": {
      const min = interpreter(node.min, env);
      const max = interpreter(node.max, env);
      return Math.floor(Math.random() * (max - min + 1) + min);
    }
  }
}

/** * ============================================================
 * SECTION 5: THE RUNNER
 * ============================================================
 */
let globalEnv = {
  values: { Math: Math },
  constants: new Set(),
  autoStatus: true,
};
let activeRL = null;

function resetEnv() {
  globalEnv = {
    values: { Math: Math },
    constants: new Set(),
    autoStatus: true,
  };
}

function promptForFile() {
  if (activeRL) activeRL.close();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  activeRL = rl;
  rl.question("[System] File path: ", (rawPath) => {
    rl.close();
    let clean = rawPath.trim().replace(/"/g, "");
    startFileMode(clean);
  });
}

function runVexal(code) {
  if (!code || !code.trim()) return;
  try {
    const tokens = lexer(code);
    const ast = parser(tokens);
    interpreter(ast, globalEnv);
  } catch (e) {
    if (e.message !== "CMD_INTERRUPT") console.error(e.message);
  }
}

function transcribeVexal(filePath) {
  try {
    const code = fs.readFileSync(filePath, "utf8");
    const tokens = lexer(code);
    const ast = parser(tokens);
    const jsCode = compile(ast);
    const outPath = path.join(path.dirname(filePath), "vexal-compiled.js");
    fs.writeFileSync(outPath, jsCode);
    console.log(`\n[Success] Transcribed to: ${outPath}`);

    exec(`node -c "${outPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.log(`[Warning] Compiled JS has syntax errors:\n${stderr}`);
      } else {
        console.log("[Verified] Compiled JS is valid.");
      }
    });
  } catch (e) {
    console.error(`[Transcribe Error] ${e.message}`);
  }
}

function startFileMode(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\n[Error] File not found: ${filePath}`);
    startReplMode(false);
    return;
  }
  try {
    resetEnv();
    const code = fs.readFileSync(filePath, "utf8");
    console.log(`\n=== VEXAL v10.2: ${path.basename(filePath)} ===`);
    runVexal(code);
    console.log(`\n=== END ===`);
  } catch (err) {
    console.error(`[Read Error] ${err.message}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  activeRL = rl;
  rl.question(
    "\n[E]dit | [R]erun | [T]ranscribe | [I]nteractive | [Q]uit > ",
    (c) => {
      const ch = c.trim().toLowerCase();
      rl.close();
      if (ch === "q") process.exit(0);
      if (ch === "r") {
        startFileMode(filePath);
        return;
      }
      if (ch === "i") {
        startReplMode(true);
        return;
      }
      if (ch === "t") {
        transcribeVexal(filePath);
        setTimeout(() => startFileMode(filePath), 1000);
        return;
      }
      if (ch === "e") {
        const nano = spawn("nano", [filePath], { stdio: "inherit" });
        nano.on("exit", () => startFileMode(filePath));
      } else {
        process.exit(0);
      }
    }
  );
}

function startReplMode(preserveState = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  activeRL = rl;
  if (!preserveState) resetEnv();
  console.log(
    `VEXAL v10.2 | ${
      preserveState ? "Interactive" : "REPL"
    } | Type 'vx' for docs.`
  );
  rl.setPrompt("vx> ");
  rl.prompt();
  rl.on("line", (line) => {
    runVexal(line);
    if (activeRL === rl) rl.prompt();
  });
}

// === BOOTSTRAP ===
const rawArg = process.argv[2];
if (rawArg) {
  let clean = rawArg.trim().replace(/"/g, "");
  startFileMode(clean);
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  activeRL = rl;
  console.log("========================================");
  console.log("          VEXAL v10.2 - Ready           ");
  console.log("========================================");
  rl.question("Run a file? (y/n): ", (answer) => {
    rl.close();
    if (["y", "yes"].includes(answer.trim().toLowerCase())) promptForFile();
    else startReplMode(false);
  });
}
