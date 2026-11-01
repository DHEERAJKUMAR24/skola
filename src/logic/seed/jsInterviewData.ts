/**
 * Sample content for a JavaScript interview, organised the way the app is meant to be used:
 * domain (Programming Languages) > subject (JavaScript) > concept > cards.
 *
 * Text uses a tiny markup: `code` for inline code, a fenced block for code samples,
 * and a blank line between paragraphs.
 */
export interface SeedCard {
  q: string;
  a: string;
  tags: string[];
}

export interface SeedConcept {
  name: string;
  description: string;
  color: "sky" | "red" | "orange" | "lime" | "fuchsia";
  /** Whole-day scheduling for this concept, to show that decks can differ. */
  daily?: boolean;
  cards: SeedCard[];
}

export const DOMAIN = {
  name: "Programming Languages",
  description: "Everything about programming languages, grouped by language.",
};

export const SUBJECT = {
  name: "JavaScript",
  description: "JavaScript interview preparation. This deck has an exam date.",
};

export const CONCEPTS: SeedConcept[] = [
  {
    name: "JS Fundamentals",
    description: "Variables, types, coercion and hoisting.",
    color: "sky",
    cards: [
      {
        q: "What is the difference between `var`, `let` and `const`?",
        a: "`var` is function-scoped, hoisted and initialised as `undefined`, and can be redeclared.\n\n`let` and `const` are block-scoped and sit in the temporal dead zone until their declaration runs.\n\n`const` forbids reassigning the binding, but the value can still be mutable.",
        tags: ["variables", "scope", "level:core"],
      },
      {
        q: "What are the primitive types in JavaScript?",
        a: "`string`, `number`, `bigint`, `boolean`, `undefined`, `null` and `symbol`.\n\nEverything else is an object, including arrays and functions. Primitives are immutable and compared by value.",
        tags: ["types", "level:core"],
      },
      {
        q: 'Why does `typeof null` return `"object"`?',
        a: "It is a bug from the first JavaScript engine, where values carried a type tag and the all-zero `null` pointer matched the object tag. It was kept for compatibility.\n\nCheck for null with `value === null`.",
        tags: ["types", "quirks", "level:tricky"],
      },
      {
        q: "What is the difference between `==` and `===`?",
        a: '`===` compares type and value with no conversion.\n\n`==` converts types first (coercion): `0 == "0"` and `null == undefined` are both true.\n\nPrefer `===`. The one common use of `==` is `x == null`, which catches both `null` and `undefined`.',
        tags: ["coercion", "operators", "level:core"],
      },
      {
        q: "What is hoisting?",
        a: "Declarations are processed before the code runs.\n\nFunction declarations are hoisted with their body. `var` is hoisted and set to `undefined`. `let`, `const` and `class` are hoisted but not initialised, so using them early throws a `ReferenceError` (the temporal dead zone).",
        tags: ["hoisting", "scope", "level:core"],
      },
      {
        q: "Which values are falsy?",
        a: '`false`, `0`, `-0`, `0n`, `""`, `null`, `undefined` and `NaN`.\n\nEverything else is truthy, including `"0"`, `[]` and `{}`.',
        tags: ["coercion", "truthiness", "level:core"],
      },
    ],
  },
  {
    name: "Functions & Scope",
    description: "Closures, this, call/apply/bind and arrow functions.",
    color: "red",
    cards: [
      {
        q: "What is a closure?",
        a: "A function together with the variables of the scope where it was created. Those variables stay alive after the outer function returns.\n\nUsed for private state, function factories and callbacks.",
        tags: ["closures", "level:core"],
      },
      {
        q: "What does this print, and how do you fix it?\n\n```\nfor (var i = 0; i < 3; i++) setTimeout(() => console.log(i));\n```",
        a: "It prints `3 3 3`: `var` is one function-scoped variable shared by every callback, and the loop has ended by the time they run.\n\nUse `let`, which creates a new binding for each iteration, and it prints `0 1 2`.",
        tags: ["closures", "var-let", "level:tricky"],
      },
      {
        q: "How is the value of `this` decided?",
        a: "By how the function is called:\n\n`new f()`: the new object. `f.call(obj)` / `apply` / `bind`: `obj`. `obj.f()`: `obj`. A plain call `f()`: `undefined` in strict mode (the global object otherwise).\n\nArrow functions take `this` from the enclosing scope.",
        tags: ["this", "level:core"],
      },
      {
        q: "What is the difference between `call`, `apply` and `bind`?",
        a: "`call(thisArg, a, b)` and `apply(thisArg, [a, b])` invoke the function immediately.\n\n`bind(thisArg, ...args)` returns a new function with `this` (and any leading arguments) fixed.",
        tags: ["this", "call-apply-bind", "level:core"],
      },
      {
        q: "How do arrow functions differ from regular functions?",
        a: "Arrows have no own `this`, `arguments`, `super` or `new.target`, cannot be called with `new`, and have no `prototype`.\n\nUse regular functions for methods that need their own `this`.",
        tags: ["arrow-functions", "this", "level:core"],
      },
      {
        q: "What is a higher-order function, and what is currying?",
        a: "A higher-order function takes or returns functions, like `map` and `filter`.\n\nCurrying turns `f(a, b, c)` into `f(a)(b)(c)`, which makes it easy to preconfigure arguments.",
        tags: ["functional", "level:core"],
      },
    ],
  },
  {
    name: "Objects & Prototypes",
    description: "The prototype chain, classes, immutability and copying.",
    color: "orange",
    cards: [
      {
        q: "What is the prototype chain?",
        a: "Every object has an internal `[[Prototype]]` link. A property lookup walks this chain until it finds the property or reaches `null`.\n\nRead the link with `Object.getPrototypeOf(obj)`.",
        tags: ["prototypes", "level:core"],
      },
      {
        q: "What is the difference between `__proto__` and `prototype`?",
        a: "`prototype` is a property of constructor functions. It becomes the `[[Prototype]]` of instances created with `new`.\n\n`__proto__` (prefer `Object.getPrototypeOf`) is the actual link on an instance.",
        tags: ["prototypes", "level:tricky"],
      },
      {
        q: "Are ES6 classes real classes?",
        a: "They are syntax over prototypes and constructor functions. Methods live on `Class.prototype`, `extends` wires the prototype chain, and `super` calls the parent.\n\nUnlike function declarations, classes are not usable before their declaration (temporal dead zone).",
        tags: ["classes", "prototypes", "level:core"],
      },
      {
        q: "Compare `Object.freeze`, `Object.seal` and `Object.preventExtensions`.",
        a: "`freeze`: no adding, removing or changing properties.\n\n`seal`: no adding or removing, but values can change.\n\n`preventExtensions`: no adding only.\n\nAll three are shallow.",
        tags: ["immutability", "level:core"],
      },
      {
        q: "What is the difference between a shallow and a deep copy?",
        a: "Spread and `Object.assign` copy one level, so nested objects stay shared.\n\n`structuredClone` makes a deep copy (but not functions or DOM nodes). A JSON round trip loses dates, `undefined`, Maps and Sets.",
        tags: ["copying", "immutability", "level:core"],
      },
      {
        q: "What does `Object.create(proto)` do?",
        a: "It creates a new object whose `[[Prototype]]` is `proto`, without running a constructor.\n\n`Object.create(null)` makes an object with no prototype, handy as a plain dictionary.",
        tags: ["prototypes", "level:core"],
      },
    ],
  },
  {
    name: "Async JavaScript",
    description: "The event loop, promises and async/await.",
    color: "lime",
    cards: [
      {
        q: "Explain the event loop.",
        a: "JavaScript runs one call stack. Async work is handled by the host, and finished callbacks wait in queues.\n\nWhen the stack is empty, the loop runs all microtasks (promise callbacks) first, then one macrotask (timer, I/O, UI event), and repeats.",
        tags: ["event-loop", "async", "level:core"],
      },
      {
        q: "What is the output order?\n\n```\nconsole.log(1);\nsetTimeout(() => console.log(2));\nPromise.resolve().then(() => console.log(3));\nconsole.log(4);\n```",
        a: "`1 4 3 2`.\n\nSynchronous code runs first (1, 4), then the microtask (3), then the macrotask (2).",
        tags: ["event-loop", "microtasks", "level:tricky"],
      },
      {
        q: "What are the states of a Promise?",
        a: "`pending`, `fulfilled` and `rejected`. Once settled, it never changes.\n\n`then` returns a new promise, so calls can be chained, and an error skips ahead to the next `catch`.",
        tags: ["promises", "async", "level:core"],
      },
      {
        q: "Compare `Promise.all`, `allSettled`, `race` and `any`.",
        a: "`all`: resolves with every value, rejects on the first rejection.\n\n`allSettled`: waits for all and reports each outcome.\n\n`race`: the first promise to settle wins.\n\n`any`: the first to fulfil (`AggregateError` if all reject).",
        tags: ["promises", "async", "level:core"],
      },
      {
        q: "How do you handle errors with async/await?",
        a: "Wrap the awaits in `try/catch` (or add `.catch`). A rejected `await` throws.\n\nA promise that is neither awaited nor returned leaves its rejection unhandled.",
        tags: ["async-await", "errors", "level:core"],
      },
      {
        q: "Why is `await` inside `forEach` a problem?",
        a: "`forEach` ignores the promises its callback returns, so it does not wait.\n\nUse `for...of` with `await` to run sequentially, or `await Promise.all(items.map(async (x) => ...))` to run in parallel.",
        tags: ["async-await", "pitfalls", "level:tricky"],
      },
    ],
  },
  {
    name: "ES6+ Features",
    description:
      "Destructuring, spread, collections, modules and newer operators.",
    color: "fuchsia",
    cards: [
      {
        q: "How do destructuring defaults and renaming work?",
        a: "```\nconst { a, b: renamed = 5, ...rest } = obj;\nconst [x, , y = 1] = arr;\n```\n\nIt also works in function parameters.",
        tags: ["destructuring", "level:core"],
      },
      {
        q: "What is the difference between spread and rest?",
        a: "Same `...` syntax, opposite jobs.\n\nSpread expands an iterable or object into elements. Rest collects the remaining items into an array or object, in parameters or destructuring.",
        tags: ["spread-rest", "level:core"],
      },
      {
        q: "When would you use a `Map` or `Set` instead of an object or array?",
        a: "`Map` allows any key type, keeps insertion order, has `size`, and suits frequent additions and removals. Objects only have string and symbol keys.\n\n`Set` stores unique values. `WeakMap` and `WeakSet` hold keys weakly, so they do not prevent garbage collection.",
        tags: ["collections", "level:core"],
      },
      {
        q: "What do `?.` and `??` do?",
        a: '`a?.b` returns `undefined` instead of throwing when `a` is `null` or `undefined`.\n\n`a ?? b` uses `b` only when `a` is `null` or `undefined`, unlike `||`, which also replaces `0`, `""` and `false`.',
        tags: ["operators", "level:core"],
      },
      {
        q: "How do ES modules differ from CommonJS?",
        a: "ESM: `import` / `export`, static (so tree-shakable), loaded asynchronously, live bindings, always strict.\n\nCommonJS: `require` / `module.exports`, dynamic, synchronous, and exports are copies of values.",
        tags: ["modules", "level:core"],
      },
      {
        q: "What are tagged template literals?",
        a: "A tag function receives the string parts and the interpolated values of a template, so it can transform them.\n\nUsed for sanitising HTML, translations and libraries like styled-components.",
        tags: ["strings", "level:core"],
      },
    ],
  },
  {
    name: "Arrays & Iteration",
    description:
      "Array methods, iterators and generators. Uses whole-day scheduling.",
    color: "sky",
    daily: true,
    cards: [
      {
        q: "What is the difference between `map` and `forEach`?",
        a: "`map` returns a new array of the callback results.\n\n`forEach` returns `undefined` and is only for side effects.",
        tags: ["arrays", "level:core"],
      },
      {
        q: "How does `reduce` work?",
        a: "`arr.reduce((acc, x) => ..., initial)` folds the items into a single value. Always pass the initial value, because `reduce` on an empty array without one throws.\n\nIt can build sums, objects and groupings.",
        tags: ["arrays", "reduce", "level:core"],
      },
      {
        q: "What is the pitfall of the default `sort`?",
        a: "Without a comparator, items are compared as strings, so `[10, 2, 1].sort()` gives `[1, 10, 2]`.\n\nUse `sort((a, b) => a - b)`. `sort` also mutates the array; `toSorted` returns a copy.",
        tags: ["arrays", "pitfalls", "level:tricky"],
      },
      {
        q: "Compare `find`, `filter`, `some` and `every`.",
        a: "`find`: the first match, or `undefined`.\n\n`filter`: all matches as an array.\n\n`some`: is there any match (boolean).\n\n`every`: do all items match (boolean).",
        tags: ["arrays", "level:core"],
      },
      {
        q: "What are iterators and generators?",
        a: "An iterable has a `[Symbol.iterator]()` method returning an iterator with `next()`.\n\nA generator function (`function*` with `yield`) produces an iterator lazily, pausing between yields.",
        tags: ["iterators", "generators", "level:core"],
      },
      {
        q: "What is the difference between `for...in` and `for...of`?",
        a: "`for...in` loops over the enumerable property keys of an object, including inherited ones.\n\n`for...of` loops over the values of an iterable (arrays, strings, Maps, Sets). Avoid `for...in` for arrays.",
        tags: ["iteration", "level:core"],
      },
    ],
  },
  {
    name: "Browser & Events",
    description: "Event flow, delegation, storage and loading scripts.",
    color: "orange",
    cards: [
      {
        q: "What is the difference between event bubbling and capturing?",
        a: "An event travels down from the window to the target (capture), then back up (bubble).\n\nListeners run during bubbling by default. Pass `{ capture: true }` to listen during capture.",
        tags: ["events", "dom", "level:core"],
      },
      {
        q: "What is event delegation?",
        a: "Attach one listener to a parent and use `event.target` (or `closest`) to handle many children, including ones added later.\n\nIt saves memory and works with dynamic content.",
        tags: ["events", "performance", "level:core"],
      },
      {
        q: "What is the difference between `preventDefault` and `stopPropagation`?",
        a: "`preventDefault` cancels the browser's default action, like following a link.\n\n`stopPropagation` stops the event reaching other elements. `stopImmediatePropagation` also stops the other listeners on the same element.",
        tags: ["events", "level:core"],
      },
      {
        q: "What is the difference between debounce and throttle?",
        a: "Debounce runs after calls stop for a delay, which suits search-as-you-type.\n\nThrottle runs at most once per interval, which suits scroll and resize handlers.",
        tags: ["performance", "functional", "level:core"],
      },
      {
        q: "Compare `localStorage`, `sessionStorage` and cookies.",
        a: "`localStorage` persists, holds about 5 MB and is per origin. `sessionStorage` lasts for the tab session.\n\nCookies are sent with every request, hold about 4 KB, and have expiry and flags like `HttpOnly`, `Secure` and `SameSite`.",
        tags: ["storage", "security", "level:core"],
      },
      {
        q: "What do `defer` and `async` do on a script tag?",
        a: "Both download the script without blocking HTML parsing.\n\n`defer` runs scripts in order after the document is parsed. `async` runs a script as soon as it has downloaded, in any order.",
        tags: ["performance", "dom", "level:core"],
      },
    ],
  },
];
