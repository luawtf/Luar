/*!
 * == Luar ==
 * Extremely small, fast and compatible (IE 9 and up) reactive programming
 * library, similar to Hyperactiv.
 *
 * MIT License
 *
 * Copyright (c) 2020 Lua MacDougall
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const { observe } = require(".");

var luar = (function () {
  "use strict";

  // Check if an object has a property, ignoring the object's prototypes
  function hasOwnProperty(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // Get the name of a function, or "unknown" if unavailable
  function getFnName(fn) {
    if (typeof fn === "function" && fn.name) {
      return fn.name;
    } else {
      return "unknown";
    }
  }
  // Make a Luar error/warning message string
  function makeErrorMessage(header, body, warn) {
    return (
      "[Luar] " + (warn ? "WRN " : "ERR ") +
      header + "\n" + body
    );
  }

  // Maximum number of tasks to execute in a single task cycle
  var computedTaskLimit = 2000;
  // Task function list (and current index into said list)
  var computedTasks = [], computedI = 0;
  // Mutex-y lock for processing the current computed task list, so that we
  // don't try to run the same tasks twice
  var computedLock = false;

  // Throw a "stack overflow" error if the length of computedTasks becomes
  // bigger than computedTaskLimit
  function computedOverflow() {
    var taskFnNames = [];

    // Gather function names of the last 10 tasks
    // Most likely contains something like [badFn1, badFn2, badFn1, badFn2, ...]
    for (var i = computedTasks.length - 10 - 1; i < computedTasks.length; i++) {
      taskFnNames[taskFnNames.length] = i + ": " + getFnName(computedTasks[i]);
    }

    throw new Error(makeErrorMessage(
      "Maximum computed task length exceeded (stack overflow!)",
      "Last 10 functions in the task:\n" +
      taskFnNames.join("\n")
    ));
  }
  // Process the current computed task list (and all of its dependencies)
  function computedProcess() {
    // Attempt to lock the mutex-thing
    if (computedLock) return;
    computedLock = true;

    // Go through and execute all the computed tasks
    for (; computedI < computedTasks.length; computedI++) {
      // Call this task
      computedTasks[computedI]();
      // Check for overflow
      if (computedI > computedOverflow) {
        computedOverflow();
      }

      // We could try using error handling?
      /*
      var fn = computedTasks[computedI];
      try {
        fn();
      } catch (err) {
        // Potentially handle this error
      }
      */
    }

    // Reset the list of tasks
    computedTasks = [];
    computedI = 0;
    // And unlock the mutex-thing
    computedLock = false;
  }
  // Notify a computed task that one of its dependencies has updated
  function computedNotify(fn) {
    // Ensure that this task is not already queued to be executed
    for (var i = computedI; i < computedTasks.length; i++) {
      if (computedTasks[i] === fn) return;
    }

    // Push this task onto the computedTasks list
    computedTasks[computedTasks.length] = fn;

    // Make sure the task list is being processed (so that the new task actually
    // runs)
    computedProcess();
  }

  // Hint property to add to observed objects, so that they don't get observed
  // again
  var observeHint = "__luar";
  // Internal observe, known good params
  function observe(obj) {
    // Don't observe it if it has the hint
    if (hasOwnProperty(obj, observeHint)) return;

    // The shadow object contains the actual values modified/returned by the
    // getters and setters
    var shadow = {};

    // List of dependant computed tasks (stored as { [key]: task[] })
    var dependencyMap = {};
    // Get a value from a key and update dependencies if we are currently in a
    // computed task
    function reactiveGet(key) {
      // Get the value to return
      var val = shadow[key];

      // Get the current task
      var fn = computedState.tasks[computedState.i];
      // Return if there is no task
      if (!fn) return val;

      // Get the dependency array for this key (or create it)
      var deps = dependencyMap[key];
      if (!deps) deps = dependencyMap[key] = [];

      // Ensure that the task is not already a dependency
      for (var i = 0; i < deps.length; i++) {
        if (deps[i] === fn) return val;
      }
      // Add the task to the dependency array
      deps[deps.length] = fn;

      return val;
    }
    // Update a key and notify all of the key's dependencies
    function reactiveSet(key, val) {
      // Update the key
      shadow[key] = val;

      // Get the dependency array for this key
      var deps = dependencyMap[key];
      // Return if there are no dependencies
      if (!deps) return;

      // Notify all the dependencies
      for (var i = 0; i < deps.length; i++) {
        computedNotify(deps[i]);
      }
    }

    // Getter/setter definitions to pass to Object.defineProperties
    var props = {};

    // Create a reactive key on an object
    function reactiveCreate(key) {
      // Get the original value from the original object
      var val = obj[key];
      // If the value is also an object, make it reactive too (deep reactivity)
      if (typeof val === "object") {
        observe(val);
      }

      // Set this value in the shadow object ...
      shadow[key] = val;
      // ... and define the getters/setters
      props[key] = {
        get: function () {
          return reactiveGet(key);
        },
        set: function (val) {
          reactiveSet(key, val);
        }
      };
    }

    // Loop over the keys of the object and make any keys that are actually part
    // of the object reactive
    for (var key in obj) {
      if (!hasOwnProperty(obj, key)) continue;
      reactiveCreate(key);
    }

    // Apply all the getters/setters ...
    Object.defineProperties(obj, props);
    // ... and define the hint, but make it non-enumerable
    Object.defineProperty(obj, observeHint, {
      enumerable: false,
      value: true
    });

    return obj;
  }

  // [Export] Make a JavaScript object reactive
  function _observe(obj) {
    // Since this is an export, typecheck its arguments
    if (typeof obj !== "object") {
      throw new Error(makeErrorMessage(
        "Attempted to observe a value that is not an object",
        "observe(obj) expects \"obj\" to be \"object\", got \"" + typeof obj + "\""
      ));
    }

    // Call internal observe
    observe(obj);
  }
  // [Export] Execute a function as a computed task and record its dependencies.
  // The task will then be re-run whenever its dependencies change.
  function _computed(fn) {
  }

  // For environments that use CommonJS modules, export the observe() and
  // computed() functions
  if (typeof exports === "object") {
    exports.observe = _observe;
    exports.computed = _computed;
  }

  // For other environments, return both functions which will be put into the
  // global "luar"
  return { observe: _observe, computed: _computed };
})();
