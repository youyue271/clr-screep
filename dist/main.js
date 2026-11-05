'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var sourceMapGenerator = {};

var base64Vlq = {};

var base64$1 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var intToCharMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');

/**
 * Encode an integer in the range of 0 to 63 to a single base 64 digit.
 */
base64$1.encode = function (number) {
  if (0 <= number && number < intToCharMap.length) {
    return intToCharMap[number];
  }
  throw new TypeError("Must be between 0 and 63: " + number);
};

/**
 * Decode a single base 64 character code digit to an integer. Returns -1 on
 * failure.
 */
base64$1.decode = function (charCode) {
  var bigA = 65;     // 'A'
  var bigZ = 90;     // 'Z'

  var littleA = 97;  // 'a'
  var littleZ = 122; // 'z'

  var zero = 48;     // '0'
  var nine = 57;     // '9'

  var plus = 43;     // '+'
  var slash = 47;    // '/'

  var littleOffset = 26;
  var numberOffset = 52;

  // 0 - 25: ABCDEFGHIJKLMNOPQRSTUVWXYZ
  if (bigA <= charCode && charCode <= bigZ) {
    return (charCode - bigA);
  }

  // 26 - 51: abcdefghijklmnopqrstuvwxyz
  if (littleA <= charCode && charCode <= littleZ) {
    return (charCode - littleA + littleOffset);
  }

  // 52 - 61: 0123456789
  if (zero <= charCode && charCode <= nine) {
    return (charCode - zero + numberOffset);
  }

  // 62: +
  if (charCode == plus) {
    return 62;
  }

  // 63: /
  if (charCode == slash) {
    return 63;
  }

  // Invalid base64 digit.
  return -1;
};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

var base64 = base64$1;

// A single base 64 digit can contain 6 bits of data. For the base 64 variable
// length quantities we use in the source map spec, the first bit is the sign,
// the next four bits are the actual value, and the 6th bit is the
// continuation bit. The continuation bit tells us whether there are more
// digits in this value following this digit.
//
//   Continuation
//   |    Sign
//   |    |
//   V    V
//   101011

var VLQ_BASE_SHIFT = 5;

// binary: 100000
var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

// binary: 011111
var VLQ_BASE_MASK = VLQ_BASE - 1;

// binary: 100000
var VLQ_CONTINUATION_BIT = VLQ_BASE;

/**
 * Converts from a two-complement value to a value where the sign bit is
 * placed in the least significant bit.  For example, as decimals:
 *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
 *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
 */
function toVLQSigned(aValue) {
  return aValue < 0
    ? ((-aValue) << 1) + 1
    : (aValue << 1) + 0;
}

/**
 * Converts to a two-complement value from a value where the sign bit is
 * placed in the least significant bit.  For example, as decimals:
 *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
 *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
 */
function fromVLQSigned(aValue) {
  var isNegative = (aValue & 1) === 1;
  var shifted = aValue >> 1;
  return isNegative
    ? -shifted
    : shifted;
}

/**
 * Returns the base 64 VLQ encoded value.
 */
base64Vlq.encode = function base64VLQ_encode(aValue) {
  var encoded = "";
  var digit;

  var vlq = toVLQSigned(aValue);

  do {
    digit = vlq & VLQ_BASE_MASK;
    vlq >>>= VLQ_BASE_SHIFT;
    if (vlq > 0) {
      // There are still more digits in this value, so we must make sure the
      // continuation bit is marked.
      digit |= VLQ_CONTINUATION_BIT;
    }
    encoded += base64.encode(digit);
  } while (vlq > 0);

  return encoded;
};

/**
 * Decodes the next base 64 VLQ value from the given string and returns the
 * value and the rest of the string via the out parameter.
 */
base64Vlq.decode = function base64VLQ_decode(aStr, aIndex, aOutParam) {
  var strLen = aStr.length;
  var result = 0;
  var shift = 0;
  var continuation, digit;

  do {
    if (aIndex >= strLen) {
      throw new Error("Expected more digits in base 64 VLQ value.");
    }

    digit = base64.decode(aStr.charCodeAt(aIndex++));
    if (digit === -1) {
      throw new Error("Invalid base64 digit: " + aStr.charAt(aIndex - 1));
    }

    continuation = !!(digit & VLQ_CONTINUATION_BIT);
    digit &= VLQ_BASE_MASK;
    result = result + (digit << shift);
    shift += VLQ_BASE_SHIFT;
  } while (continuation);

  aOutParam.value = fromVLQSigned(result);
  aOutParam.rest = aIndex;
};

var util$5 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

(function (exports) {
	/*
	 * Copyright 2011 Mozilla Foundation and contributors
	 * Licensed under the New BSD license. See LICENSE or:
	 * http://opensource.org/licenses/BSD-3-Clause
	 */

	/**
	 * This is a helper function for getting values from parameter/options
	 * objects.
	 *
	 * @param args The object we are extracting values from
	 * @param name The name of the property we are getting.
	 * @param defaultValue An optional value to return if the property is missing
	 * from the object. If this is not specified and the property is missing, an
	 * error will be thrown.
	 */
	function getArg(aArgs, aName, aDefaultValue) {
	  if (aName in aArgs) {
	    return aArgs[aName];
	  } else if (arguments.length === 3) {
	    return aDefaultValue;
	  } else {
	    throw new Error('"' + aName + '" is a required argument.');
	  }
	}
	exports.getArg = getArg;

	var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.-]*)(?::(\d+))?(.*)$/;
	var dataUrlRegexp = /^data:.+\,.+$/;

	function urlParse(aUrl) {
	  var match = aUrl.match(urlRegexp);
	  if (!match) {
	    return null;
	  }
	  return {
	    scheme: match[1],
	    auth: match[2],
	    host: match[3],
	    port: match[4],
	    path: match[5]
	  };
	}
	exports.urlParse = urlParse;

	function urlGenerate(aParsedUrl) {
	  var url = '';
	  if (aParsedUrl.scheme) {
	    url += aParsedUrl.scheme + ':';
	  }
	  url += '//';
	  if (aParsedUrl.auth) {
	    url += aParsedUrl.auth + '@';
	  }
	  if (aParsedUrl.host) {
	    url += aParsedUrl.host;
	  }
	  if (aParsedUrl.port) {
	    url += ":" + aParsedUrl.port;
	  }
	  if (aParsedUrl.path) {
	    url += aParsedUrl.path;
	  }
	  return url;
	}
	exports.urlGenerate = urlGenerate;

	/**
	 * Normalizes a path, or the path portion of a URL:
	 *
	 * - Replaces consecutive slashes with one slash.
	 * - Removes unnecessary '.' parts.
	 * - Removes unnecessary '<dir>/..' parts.
	 *
	 * Based on code in the Node.js 'path' core module.
	 *
	 * @param aPath The path or url to normalize.
	 */
	function normalize(aPath) {
	  var path = aPath;
	  var url = urlParse(aPath);
	  if (url) {
	    if (!url.path) {
	      return aPath;
	    }
	    path = url.path;
	  }
	  var isAbsolute = exports.isAbsolute(path);

	  var parts = path.split(/\/+/);
	  for (var part, up = 0, i = parts.length - 1; i >= 0; i--) {
	    part = parts[i];
	    if (part === '.') {
	      parts.splice(i, 1);
	    } else if (part === '..') {
	      up++;
	    } else if (up > 0) {
	      if (part === '') {
	        // The first part is blank if the path is absolute. Trying to go
	        // above the root is a no-op. Therefore we can remove all '..' parts
	        // directly after the root.
	        parts.splice(i + 1, up);
	        up = 0;
	      } else {
	        parts.splice(i, 2);
	        up--;
	      }
	    }
	  }
	  path = parts.join('/');

	  if (path === '') {
	    path = isAbsolute ? '/' : '.';
	  }

	  if (url) {
	    url.path = path;
	    return urlGenerate(url);
	  }
	  return path;
	}
	exports.normalize = normalize;

	/**
	 * Joins two paths/URLs.
	 *
	 * @param aRoot The root path or URL.
	 * @param aPath The path or URL to be joined with the root.
	 *
	 * - If aPath is a URL or a data URI, aPath is returned, unless aPath is a
	 *   scheme-relative URL: Then the scheme of aRoot, if any, is prepended
	 *   first.
	 * - Otherwise aPath is a path. If aRoot is a URL, then its path portion
	 *   is updated with the result and aRoot is returned. Otherwise the result
	 *   is returned.
	 *   - If aPath is absolute, the result is aPath.
	 *   - Otherwise the two paths are joined with a slash.
	 * - Joining for example 'http://' and 'www.example.com' is also supported.
	 */
	function join(aRoot, aPath) {
	  if (aRoot === "") {
	    aRoot = ".";
	  }
	  if (aPath === "") {
	    aPath = ".";
	  }
	  var aPathUrl = urlParse(aPath);
	  var aRootUrl = urlParse(aRoot);
	  if (aRootUrl) {
	    aRoot = aRootUrl.path || '/';
	  }

	  // `join(foo, '//www.example.org')`
	  if (aPathUrl && !aPathUrl.scheme) {
	    if (aRootUrl) {
	      aPathUrl.scheme = aRootUrl.scheme;
	    }
	    return urlGenerate(aPathUrl);
	  }

	  if (aPathUrl || aPath.match(dataUrlRegexp)) {
	    return aPath;
	  }

	  // `join('http://', 'www.example.com')`
	  if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
	    aRootUrl.host = aPath;
	    return urlGenerate(aRootUrl);
	  }

	  var joined = aPath.charAt(0) === '/'
	    ? aPath
	    : normalize(aRoot.replace(/\/+$/, '') + '/' + aPath);

	  if (aRootUrl) {
	    aRootUrl.path = joined;
	    return urlGenerate(aRootUrl);
	  }
	  return joined;
	}
	exports.join = join;

	exports.isAbsolute = function (aPath) {
	  return aPath.charAt(0) === '/' || urlRegexp.test(aPath);
	};

	/**
	 * Make a path relative to a URL or another path.
	 *
	 * @param aRoot The root path or URL.
	 * @param aPath The path or URL to be made relative to aRoot.
	 */
	function relative(aRoot, aPath) {
	  if (aRoot === "") {
	    aRoot = ".";
	  }

	  aRoot = aRoot.replace(/\/$/, '');

	  // It is possible for the path to be above the root. In this case, simply
	  // checking whether the root is a prefix of the path won't work. Instead, we
	  // need to remove components from the root one by one, until either we find
	  // a prefix that fits, or we run out of components to remove.
	  var level = 0;
	  while (aPath.indexOf(aRoot + '/') !== 0) {
	    var index = aRoot.lastIndexOf("/");
	    if (index < 0) {
	      return aPath;
	    }

	    // If the only part of the root that is left is the scheme (i.e. http://,
	    // file:///, etc.), one or more slashes (/), or simply nothing at all, we
	    // have exhausted all components, so the path is not relative to the root.
	    aRoot = aRoot.slice(0, index);
	    if (aRoot.match(/^([^\/]+:\/)?\/*$/)) {
	      return aPath;
	    }

	    ++level;
	  }

	  // Make sure we add a "../" for each component we removed from the root.
	  return Array(level + 1).join("../") + aPath.substr(aRoot.length + 1);
	}
	exports.relative = relative;

	var supportsNullProto = (function () {
	  var obj = Object.create(null);
	  return !('__proto__' in obj);
	}());

	function identity (s) {
	  return s;
	}

	/**
	 * Because behavior goes wacky when you set `__proto__` on objects, we
	 * have to prefix all the strings in our set with an arbitrary character.
	 *
	 * See https://github.com/mozilla/source-map/pull/31 and
	 * https://github.com/mozilla/source-map/issues/30
	 *
	 * @param String aStr
	 */
	function toSetString(aStr) {
	  if (isProtoString(aStr)) {
	    return '$' + aStr;
	  }

	  return aStr;
	}
	exports.toSetString = supportsNullProto ? identity : toSetString;

	function fromSetString(aStr) {
	  if (isProtoString(aStr)) {
	    return aStr.slice(1);
	  }

	  return aStr;
	}
	exports.fromSetString = supportsNullProto ? identity : fromSetString;

	function isProtoString(s) {
	  if (!s) {
	    return false;
	  }

	  var length = s.length;

	  if (length < 9 /* "__proto__".length */) {
	    return false;
	  }

	  if (s.charCodeAt(length - 1) !== 95  /* '_' */ ||
	      s.charCodeAt(length - 2) !== 95  /* '_' */ ||
	      s.charCodeAt(length - 3) !== 111 /* 'o' */ ||
	      s.charCodeAt(length - 4) !== 116 /* 't' */ ||
	      s.charCodeAt(length - 5) !== 111 /* 'o' */ ||
	      s.charCodeAt(length - 6) !== 114 /* 'r' */ ||
	      s.charCodeAt(length - 7) !== 112 /* 'p' */ ||
	      s.charCodeAt(length - 8) !== 95  /* '_' */ ||
	      s.charCodeAt(length - 9) !== 95  /* '_' */) {
	    return false;
	  }

	  for (var i = length - 10; i >= 0; i--) {
	    if (s.charCodeAt(i) !== 36 /* '$' */) {
	      return false;
	    }
	  }

	  return true;
	}

	/**
	 * Comparator between two mappings where the original positions are compared.
	 *
	 * Optionally pass in `true` as `onlyCompareGenerated` to consider two
	 * mappings with the same original source/line/column, but different generated
	 * line and column the same. Useful when searching for a mapping with a
	 * stubbed out mapping.
	 */
	function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
	  var cmp = strcmp(mappingA.source, mappingB.source);
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.originalLine - mappingB.originalLine;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.originalColumn - mappingB.originalColumn;
	  if (cmp !== 0 || onlyCompareOriginal) {
	    return cmp;
	  }

	  cmp = mappingA.generatedColumn - mappingB.generatedColumn;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.generatedLine - mappingB.generatedLine;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  return strcmp(mappingA.name, mappingB.name);
	}
	exports.compareByOriginalPositions = compareByOriginalPositions;

	/**
	 * Comparator between two mappings with deflated source and name indices where
	 * the generated positions are compared.
	 *
	 * Optionally pass in `true` as `onlyCompareGenerated` to consider two
	 * mappings with the same generated line and column, but different
	 * source/name/original line and column the same. Useful when searching for a
	 * mapping with a stubbed out mapping.
	 */
	function compareByGeneratedPositionsDeflated(mappingA, mappingB, onlyCompareGenerated) {
	  var cmp = mappingA.generatedLine - mappingB.generatedLine;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.generatedColumn - mappingB.generatedColumn;
	  if (cmp !== 0 || onlyCompareGenerated) {
	    return cmp;
	  }

	  cmp = strcmp(mappingA.source, mappingB.source);
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.originalLine - mappingB.originalLine;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.originalColumn - mappingB.originalColumn;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  return strcmp(mappingA.name, mappingB.name);
	}
	exports.compareByGeneratedPositionsDeflated = compareByGeneratedPositionsDeflated;

	function strcmp(aStr1, aStr2) {
	  if (aStr1 === aStr2) {
	    return 0;
	  }

	  if (aStr1 === null) {
	    return 1; // aStr2 !== null
	  }

	  if (aStr2 === null) {
	    return -1; // aStr1 !== null
	  }

	  if (aStr1 > aStr2) {
	    return 1;
	  }

	  return -1;
	}

	/**
	 * Comparator between two mappings with inflated source and name strings where
	 * the generated positions are compared.
	 */
	function compareByGeneratedPositionsInflated(mappingA, mappingB) {
	  var cmp = mappingA.generatedLine - mappingB.generatedLine;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.generatedColumn - mappingB.generatedColumn;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = strcmp(mappingA.source, mappingB.source);
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.originalLine - mappingB.originalLine;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  cmp = mappingA.originalColumn - mappingB.originalColumn;
	  if (cmp !== 0) {
	    return cmp;
	  }

	  return strcmp(mappingA.name, mappingB.name);
	}
	exports.compareByGeneratedPositionsInflated = compareByGeneratedPositionsInflated;

	/**
	 * Strip any JSON XSSI avoidance prefix from the string (as documented
	 * in the source maps specification), and then parse the string as
	 * JSON.
	 */
	function parseSourceMapInput(str) {
	  return JSON.parse(str.replace(/^\)]}'[^\n]*\n/, ''));
	}
	exports.parseSourceMapInput = parseSourceMapInput;

	/**
	 * Compute the URL of a source given the the source root, the source's
	 * URL, and the source map's URL.
	 */
	function computeSourceURL(sourceRoot, sourceURL, sourceMapURL) {
	  sourceURL = sourceURL || '';

	  if (sourceRoot) {
	    // This follows what Chrome does.
	    if (sourceRoot[sourceRoot.length - 1] !== '/' && sourceURL[0] !== '/') {
	      sourceRoot += '/';
	    }
	    // The spec says:
	    //   Line 4: An optional source root, useful for relocating source
	    //   files on a server or removing repeated values in the
	    //   “sources” entry.  This value is prepended to the individual
	    //   entries in the “source” field.
	    sourceURL = sourceRoot + sourceURL;
	  }

	  // Historically, SourceMapConsumer did not take the sourceMapURL as
	  // a parameter.  This mode is still somewhat supported, which is why
	  // this code block is conditional.  However, it's preferable to pass
	  // the source map URL to SourceMapConsumer, so that this function
	  // can implement the source URL resolution algorithm as outlined in
	  // the spec.  This block is basically the equivalent of:
	  //    new URL(sourceURL, sourceMapURL).toString()
	  // ... except it avoids using URL, which wasn't available in the
	  // older releases of node still supported by this library.
	  //
	  // The spec says:
	  //   If the sources are not absolute URLs after prepending of the
	  //   “sourceRoot”, the sources are resolved relative to the
	  //   SourceMap (like resolving script src in a html document).
	  if (sourceMapURL) {
	    var parsed = urlParse(sourceMapURL);
	    if (!parsed) {
	      throw new Error("sourceMapURL could not be parsed");
	    }
	    if (parsed.path) {
	      // Strip the last path component, but keep the "/".
	      var index = parsed.path.lastIndexOf('/');
	      if (index >= 0) {
	        parsed.path = parsed.path.substring(0, index + 1);
	      }
	    }
	    sourceURL = join(urlGenerate(parsed), sourceURL);
	  }

	  return normalize(sourceURL);
	}
	exports.computeSourceURL = computeSourceURL;
} (util$5));

var arraySet = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util$4 = util$5;
var has = Object.prototype.hasOwnProperty;
var hasNativeMap = typeof Map !== "undefined";

/**
 * A data structure which is a combination of an array and a set. Adding a new
 * member is O(1), testing for membership is O(1), and finding the index of an
 * element is O(1). Removing elements from the set is not supported. Only
 * strings are supported for membership.
 */
function ArraySet$2() {
  this._array = [];
  this._set = hasNativeMap ? new Map() : Object.create(null);
}

/**
 * Static method for creating ArraySet instances from an existing array.
 */
ArraySet$2.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
  var set = new ArraySet$2();
  for (var i = 0, len = aArray.length; i < len; i++) {
    set.add(aArray[i], aAllowDuplicates);
  }
  return set;
};

/**
 * Return how many unique items are in this ArraySet. If duplicates have been
 * added, than those do not count towards the size.
 *
 * @returns Number
 */
ArraySet$2.prototype.size = function ArraySet_size() {
  return hasNativeMap ? this._set.size : Object.getOwnPropertyNames(this._set).length;
};

/**
 * Add the given string to this set.
 *
 * @param String aStr
 */
ArraySet$2.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
  var sStr = hasNativeMap ? aStr : util$4.toSetString(aStr);
  var isDuplicate = hasNativeMap ? this.has(aStr) : has.call(this._set, sStr);
  var idx = this._array.length;
  if (!isDuplicate || aAllowDuplicates) {
    this._array.push(aStr);
  }
  if (!isDuplicate) {
    if (hasNativeMap) {
      this._set.set(aStr, idx);
    } else {
      this._set[sStr] = idx;
    }
  }
};

/**
 * Is the given string a member of this set?
 *
 * @param String aStr
 */
ArraySet$2.prototype.has = function ArraySet_has(aStr) {
  if (hasNativeMap) {
    return this._set.has(aStr);
  } else {
    var sStr = util$4.toSetString(aStr);
    return has.call(this._set, sStr);
  }
};

/**
 * What is the index of the given string in the array?
 *
 * @param String aStr
 */
ArraySet$2.prototype.indexOf = function ArraySet_indexOf(aStr) {
  if (hasNativeMap) {
    var idx = this._set.get(aStr);
    if (idx >= 0) {
        return idx;
    }
  } else {
    var sStr = util$4.toSetString(aStr);
    if (has.call(this._set, sStr)) {
      return this._set[sStr];
    }
  }

  throw new Error('"' + aStr + '" is not in the set.');
};

/**
 * What is the element at the given index?
 *
 * @param Number aIdx
 */
ArraySet$2.prototype.at = function ArraySet_at(aIdx) {
  if (aIdx >= 0 && aIdx < this._array.length) {
    return this._array[aIdx];
  }
  throw new Error('No element indexed by ' + aIdx);
};

/**
 * Returns the array representation of this set (which has the proper indices
 * indicated by indexOf). Note that this is a copy of the internal array used
 * for storing the members so that no one can mess with internal state.
 */
ArraySet$2.prototype.toArray = function ArraySet_toArray() {
  return this._array.slice();
};

arraySet.ArraySet = ArraySet$2;

var mappingList = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2014 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util$3 = util$5;

/**
 * Determine whether mappingB is after mappingA with respect to generated
 * position.
 */
function generatedPositionAfter(mappingA, mappingB) {
  // Optimized for most common case
  var lineA = mappingA.generatedLine;
  var lineB = mappingB.generatedLine;
  var columnA = mappingA.generatedColumn;
  var columnB = mappingB.generatedColumn;
  return lineB > lineA || lineB == lineA && columnB >= columnA ||
         util$3.compareByGeneratedPositionsInflated(mappingA, mappingB) <= 0;
}

/**
 * A data structure to provide a sorted view of accumulated mappings in a
 * performance conscious manner. It trades a neglibable overhead in general
 * case for a large speedup in case of mappings being added in order.
 */
function MappingList$1() {
  this._array = [];
  this._sorted = true;
  // Serves as infimum
  this._last = {generatedLine: -1, generatedColumn: 0};
}

/**
 * Iterate through internal items. This method takes the same arguments that
 * `Array.prototype.forEach` takes.
 *
 * NOTE: The order of the mappings is NOT guaranteed.
 */
MappingList$1.prototype.unsortedForEach =
  function MappingList_forEach(aCallback, aThisArg) {
    this._array.forEach(aCallback, aThisArg);
  };

/**
 * Add the given source mapping.
 *
 * @param Object aMapping
 */
MappingList$1.prototype.add = function MappingList_add(aMapping) {
  if (generatedPositionAfter(this._last, aMapping)) {
    this._last = aMapping;
    this._array.push(aMapping);
  } else {
    this._sorted = false;
    this._array.push(aMapping);
  }
};

/**
 * Returns the flat, sorted array of mappings. The mappings are sorted by
 * generated position.
 *
 * WARNING: This method returns internal data without copying, for
 * performance. The return value must NOT be mutated, and should be treated as
 * an immutable borrow. If you want to take ownership, you must make your own
 * copy.
 */
MappingList$1.prototype.toArray = function MappingList_toArray() {
  if (!this._sorted) {
    this._array.sort(util$3.compareByGeneratedPositionsInflated);
    this._sorted = true;
  }
  return this._array;
};

mappingList.MappingList = MappingList$1;

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var base64VLQ$1 = base64Vlq;
var util$2 = util$5;
var ArraySet$1 = arraySet.ArraySet;
var MappingList = mappingList.MappingList;

/**
 * An instance of the SourceMapGenerator represents a source map which is
 * being built incrementally. You may pass an object with the following
 * properties:
 *
 *   - file: The filename of the generated source.
 *   - sourceRoot: A root for all relative URLs in this source map.
 */
function SourceMapGenerator$1(aArgs) {
  if (!aArgs) {
    aArgs = {};
  }
  this._file = util$2.getArg(aArgs, 'file', null);
  this._sourceRoot = util$2.getArg(aArgs, 'sourceRoot', null);
  this._skipValidation = util$2.getArg(aArgs, 'skipValidation', false);
  this._sources = new ArraySet$1();
  this._names = new ArraySet$1();
  this._mappings = new MappingList();
  this._sourcesContents = null;
}

SourceMapGenerator$1.prototype._version = 3;

/**
 * Creates a new SourceMapGenerator based on a SourceMapConsumer
 *
 * @param aSourceMapConsumer The SourceMap.
 */
SourceMapGenerator$1.fromSourceMap =
  function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
    var sourceRoot = aSourceMapConsumer.sourceRoot;
    var generator = new SourceMapGenerator$1({
      file: aSourceMapConsumer.file,
      sourceRoot: sourceRoot
    });
    aSourceMapConsumer.eachMapping(function (mapping) {
      var newMapping = {
        generated: {
          line: mapping.generatedLine,
          column: mapping.generatedColumn
        }
      };

      if (mapping.source != null) {
        newMapping.source = mapping.source;
        if (sourceRoot != null) {
          newMapping.source = util$2.relative(sourceRoot, newMapping.source);
        }

        newMapping.original = {
          line: mapping.originalLine,
          column: mapping.originalColumn
        };

        if (mapping.name != null) {
          newMapping.name = mapping.name;
        }
      }

      generator.addMapping(newMapping);
    });
    aSourceMapConsumer.sources.forEach(function (sourceFile) {
      var sourceRelative = sourceFile;
      if (sourceRoot !== null) {
        sourceRelative = util$2.relative(sourceRoot, sourceFile);
      }

      if (!generator._sources.has(sourceRelative)) {
        generator._sources.add(sourceRelative);
      }

      var content = aSourceMapConsumer.sourceContentFor(sourceFile);
      if (content != null) {
        generator.setSourceContent(sourceFile, content);
      }
    });
    return generator;
  };

/**
 * Add a single mapping from original source line and column to the generated
 * source's line and column for this source map being created. The mapping
 * object should have the following properties:
 *
 *   - generated: An object with the generated line and column positions.
 *   - original: An object with the original line and column positions.
 *   - source: The original source file (relative to the sourceRoot).
 *   - name: An optional original token name for this mapping.
 */
SourceMapGenerator$1.prototype.addMapping =
  function SourceMapGenerator_addMapping(aArgs) {
    var generated = util$2.getArg(aArgs, 'generated');
    var original = util$2.getArg(aArgs, 'original', null);
    var source = util$2.getArg(aArgs, 'source', null);
    var name = util$2.getArg(aArgs, 'name', null);

    if (!this._skipValidation) {
      this._validateMapping(generated, original, source, name);
    }

    if (source != null) {
      source = String(source);
      if (!this._sources.has(source)) {
        this._sources.add(source);
      }
    }

    if (name != null) {
      name = String(name);
      if (!this._names.has(name)) {
        this._names.add(name);
      }
    }

    this._mappings.add({
      generatedLine: generated.line,
      generatedColumn: generated.column,
      originalLine: original != null && original.line,
      originalColumn: original != null && original.column,
      source: source,
      name: name
    });
  };

/**
 * Set the source content for a source file.
 */
SourceMapGenerator$1.prototype.setSourceContent =
  function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
    var source = aSourceFile;
    if (this._sourceRoot != null) {
      source = util$2.relative(this._sourceRoot, source);
    }

    if (aSourceContent != null) {
      // Add the source content to the _sourcesContents map.
      // Create a new _sourcesContents map if the property is null.
      if (!this._sourcesContents) {
        this._sourcesContents = Object.create(null);
      }
      this._sourcesContents[util$2.toSetString(source)] = aSourceContent;
    } else if (this._sourcesContents) {
      // Remove the source file from the _sourcesContents map.
      // If the _sourcesContents map is empty, set the property to null.
      delete this._sourcesContents[util$2.toSetString(source)];
      if (Object.keys(this._sourcesContents).length === 0) {
        this._sourcesContents = null;
      }
    }
  };

/**
 * Applies the mappings of a sub-source-map for a specific source file to the
 * source map being generated. Each mapping to the supplied source file is
 * rewritten using the supplied source map. Note: The resolution for the
 * resulting mappings is the minimium of this map and the supplied map.
 *
 * @param aSourceMapConsumer The source map to be applied.
 * @param aSourceFile Optional. The filename of the source file.
 *        If omitted, SourceMapConsumer's file property will be used.
 * @param aSourceMapPath Optional. The dirname of the path to the source map
 *        to be applied. If relative, it is relative to the SourceMapConsumer.
 *        This parameter is needed when the two source maps aren't in the same
 *        directory, and the source map to be applied contains relative source
 *        paths. If so, those relative source paths need to be rewritten
 *        relative to the SourceMapGenerator.
 */
SourceMapGenerator$1.prototype.applySourceMap =
  function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
    var sourceFile = aSourceFile;
    // If aSourceFile is omitted, we will use the file property of the SourceMap
    if (aSourceFile == null) {
      if (aSourceMapConsumer.file == null) {
        throw new Error(
          'SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, ' +
          'or the source map\'s "file" property. Both were omitted.'
        );
      }
      sourceFile = aSourceMapConsumer.file;
    }
    var sourceRoot = this._sourceRoot;
    // Make "sourceFile" relative if an absolute Url is passed.
    if (sourceRoot != null) {
      sourceFile = util$2.relative(sourceRoot, sourceFile);
    }
    // Applying the SourceMap can add and remove items from the sources and
    // the names array.
    var newSources = new ArraySet$1();
    var newNames = new ArraySet$1();

    // Find mappings for the "sourceFile"
    this._mappings.unsortedForEach(function (mapping) {
      if (mapping.source === sourceFile && mapping.originalLine != null) {
        // Check if it can be mapped by the source map, then update the mapping.
        var original = aSourceMapConsumer.originalPositionFor({
          line: mapping.originalLine,
          column: mapping.originalColumn
        });
        if (original.source != null) {
          // Copy mapping
          mapping.source = original.source;
          if (aSourceMapPath != null) {
            mapping.source = util$2.join(aSourceMapPath, mapping.source);
          }
          if (sourceRoot != null) {
            mapping.source = util$2.relative(sourceRoot, mapping.source);
          }
          mapping.originalLine = original.line;
          mapping.originalColumn = original.column;
          if (original.name != null) {
            mapping.name = original.name;
          }
        }
      }

      var source = mapping.source;
      if (source != null && !newSources.has(source)) {
        newSources.add(source);
      }

      var name = mapping.name;
      if (name != null && !newNames.has(name)) {
        newNames.add(name);
      }

    }, this);
    this._sources = newSources;
    this._names = newNames;

    // Copy sourcesContents of applied map.
    aSourceMapConsumer.sources.forEach(function (sourceFile) {
      var content = aSourceMapConsumer.sourceContentFor(sourceFile);
      if (content != null) {
        if (aSourceMapPath != null) {
          sourceFile = util$2.join(aSourceMapPath, sourceFile);
        }
        if (sourceRoot != null) {
          sourceFile = util$2.relative(sourceRoot, sourceFile);
        }
        this.setSourceContent(sourceFile, content);
      }
    }, this);
  };

/**
 * A mapping can have one of the three levels of data:
 *
 *   1. Just the generated position.
 *   2. The Generated position, original position, and original source.
 *   3. Generated and original position, original source, as well as a name
 *      token.
 *
 * To maintain consistency, we validate that any new mapping being added falls
 * in to one of these categories.
 */
SourceMapGenerator$1.prototype._validateMapping =
  function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                              aName) {
    // When aOriginal is truthy but has empty values for .line and .column,
    // it is most likely a programmer error. In this case we throw a very
    // specific error message to try to guide them the right way.
    // For example: https://github.com/Polymer/polymer-bundler/pull/519
    if (aOriginal && typeof aOriginal.line !== 'number' && typeof aOriginal.column !== 'number') {
        throw new Error(
            'original.line and original.column are not numbers -- you probably meant to omit ' +
            'the original mapping entirely and only map the generated position. If so, pass ' +
            'null for the original mapping instead of an object with empty or null values.'
        );
    }

    if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
        && aGenerated.line > 0 && aGenerated.column >= 0
        && !aOriginal && !aSource && !aName) {
      // Case 1.
      return;
    }
    else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
             && aOriginal && 'line' in aOriginal && 'column' in aOriginal
             && aGenerated.line > 0 && aGenerated.column >= 0
             && aOriginal.line > 0 && aOriginal.column >= 0
             && aSource) {
      // Cases 2 and 3.
      return;
    }
    else {
      throw new Error('Invalid mapping: ' + JSON.stringify({
        generated: aGenerated,
        source: aSource,
        original: aOriginal,
        name: aName
      }));
    }
  };

/**
 * Serialize the accumulated mappings in to the stream of base 64 VLQs
 * specified by the source map format.
 */
SourceMapGenerator$1.prototype._serializeMappings =
  function SourceMapGenerator_serializeMappings() {
    var previousGeneratedColumn = 0;
    var previousGeneratedLine = 1;
    var previousOriginalColumn = 0;
    var previousOriginalLine = 0;
    var previousName = 0;
    var previousSource = 0;
    var result = '';
    var next;
    var mapping;
    var nameIdx;
    var sourceIdx;

    var mappings = this._mappings.toArray();
    for (var i = 0, len = mappings.length; i < len; i++) {
      mapping = mappings[i];
      next = '';

      if (mapping.generatedLine !== previousGeneratedLine) {
        previousGeneratedColumn = 0;
        while (mapping.generatedLine !== previousGeneratedLine) {
          next += ';';
          previousGeneratedLine++;
        }
      }
      else {
        if (i > 0) {
          if (!util$2.compareByGeneratedPositionsInflated(mapping, mappings[i - 1])) {
            continue;
          }
          next += ',';
        }
      }

      next += base64VLQ$1.encode(mapping.generatedColumn
                                 - previousGeneratedColumn);
      previousGeneratedColumn = mapping.generatedColumn;

      if (mapping.source != null) {
        sourceIdx = this._sources.indexOf(mapping.source);
        next += base64VLQ$1.encode(sourceIdx - previousSource);
        previousSource = sourceIdx;

        // lines are stored 0-based in SourceMap spec version 3
        next += base64VLQ$1.encode(mapping.originalLine - 1
                                   - previousOriginalLine);
        previousOriginalLine = mapping.originalLine - 1;

        next += base64VLQ$1.encode(mapping.originalColumn
                                   - previousOriginalColumn);
        previousOriginalColumn = mapping.originalColumn;

        if (mapping.name != null) {
          nameIdx = this._names.indexOf(mapping.name);
          next += base64VLQ$1.encode(nameIdx - previousName);
          previousName = nameIdx;
        }
      }

      result += next;
    }

    return result;
  };

SourceMapGenerator$1.prototype._generateSourcesContent =
  function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
    return aSources.map(function (source) {
      if (!this._sourcesContents) {
        return null;
      }
      if (aSourceRoot != null) {
        source = util$2.relative(aSourceRoot, source);
      }
      var key = util$2.toSetString(source);
      return Object.prototype.hasOwnProperty.call(this._sourcesContents, key)
        ? this._sourcesContents[key]
        : null;
    }, this);
  };

/**
 * Externalize the source map.
 */
SourceMapGenerator$1.prototype.toJSON =
  function SourceMapGenerator_toJSON() {
    var map = {
      version: this._version,
      sources: this._sources.toArray(),
      names: this._names.toArray(),
      mappings: this._serializeMappings()
    };
    if (this._file != null) {
      map.file = this._file;
    }
    if (this._sourceRoot != null) {
      map.sourceRoot = this._sourceRoot;
    }
    if (this._sourcesContents) {
      map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
    }

    return map;
  };

/**
 * Render the source map being generated to a string.
 */
SourceMapGenerator$1.prototype.toString =
  function SourceMapGenerator_toString() {
    return JSON.stringify(this.toJSON());
  };

sourceMapGenerator.SourceMapGenerator = SourceMapGenerator$1;

var sourceMapConsumer = {};

var binarySearch$1 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

(function (exports) {
	/*
	 * Copyright 2011 Mozilla Foundation and contributors
	 * Licensed under the New BSD license. See LICENSE or:
	 * http://opensource.org/licenses/BSD-3-Clause
	 */

	exports.GREATEST_LOWER_BOUND = 1;
	exports.LEAST_UPPER_BOUND = 2;

	/**
	 * Recursive implementation of binary search.
	 *
	 * @param aLow Indices here and lower do not contain the needle.
	 * @param aHigh Indices here and higher do not contain the needle.
	 * @param aNeedle The element being searched for.
	 * @param aHaystack The non-empty array being searched.
	 * @param aCompare Function which takes two elements and returns -1, 0, or 1.
	 * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
	 *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
	 *     closest element that is smaller than or greater than the one we are
	 *     searching for, respectively, if the exact element cannot be found.
	 */
	function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare, aBias) {
	  // This function terminates when one of the following is true:
	  //
	  //   1. We find the exact element we are looking for.
	  //
	  //   2. We did not find the exact element, but we can return the index of
	  //      the next-closest element.
	  //
	  //   3. We did not find the exact element, and there is no next-closest
	  //      element than the one we are searching for, so we return -1.
	  var mid = Math.floor((aHigh - aLow) / 2) + aLow;
	  var cmp = aCompare(aNeedle, aHaystack[mid], true);
	  if (cmp === 0) {
	    // Found the element we are looking for.
	    return mid;
	  }
	  else if (cmp > 0) {
	    // Our needle is greater than aHaystack[mid].
	    if (aHigh - mid > 1) {
	      // The element is in the upper half.
	      return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare, aBias);
	    }

	    // The exact needle element was not found in this haystack. Determine if
	    // we are in termination case (3) or (2) and return the appropriate thing.
	    if (aBias == exports.LEAST_UPPER_BOUND) {
	      return aHigh < aHaystack.length ? aHigh : -1;
	    } else {
	      return mid;
	    }
	  }
	  else {
	    // Our needle is less than aHaystack[mid].
	    if (mid - aLow > 1) {
	      // The element is in the lower half.
	      return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare, aBias);
	    }

	    // we are in termination case (3) or (2) and return the appropriate thing.
	    if (aBias == exports.LEAST_UPPER_BOUND) {
	      return mid;
	    } else {
	      return aLow < 0 ? -1 : aLow;
	    }
	  }
	}

	/**
	 * This is an implementation of binary search which will always try and return
	 * the index of the closest element if there is no exact hit. This is because
	 * mappings between original and generated line/col pairs are single points,
	 * and there is an implicit region between each of them, so a miss just means
	 * that you aren't on the very start of a region.
	 *
	 * @param aNeedle The element you are looking for.
	 * @param aHaystack The array that is being searched.
	 * @param aCompare A function which takes the needle and an element in the
	 *     array and returns -1, 0, or 1 depending on whether the needle is less
	 *     than, equal to, or greater than the element, respectively.
	 * @param aBias Either 'binarySearch.GREATEST_LOWER_BOUND' or
	 *     'binarySearch.LEAST_UPPER_BOUND'. Specifies whether to return the
	 *     closest element that is smaller than or greater than the one we are
	 *     searching for, respectively, if the exact element cannot be found.
	 *     Defaults to 'binarySearch.GREATEST_LOWER_BOUND'.
	 */
	exports.search = function search(aNeedle, aHaystack, aCompare, aBias) {
	  if (aHaystack.length === 0) {
	    return -1;
	  }

	  var index = recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack,
	                              aCompare, aBias || exports.GREATEST_LOWER_BOUND);
	  if (index < 0) {
	    return -1;
	  }

	  // We have found either the exact element, or the next-closest element than
	  // the one we are searching for. However, there may be more than one such
	  // element. Make sure we always return the smallest of these.
	  while (index - 1 >= 0) {
	    if (aCompare(aHaystack[index], aHaystack[index - 1], true) !== 0) {
	      break;
	    }
	    --index;
	  }

	  return index;
	};
} (binarySearch$1));

var quickSort$1 = {};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

// It turns out that some (most?) JavaScript engines don't self-host
// `Array.prototype.sort`. This makes sense because C++ will likely remain
// faster than JS when doing raw CPU-intensive sorting. However, when using a
// custom comparator function, calling back and forth between the VM's C++ and
// JIT'd JS is rather slow *and* loses JIT type information, resulting in
// worse generated code for the comparator function than would be optimal. In
// fact, when sorting with a comparator, these costs outweigh the benefits of
// sorting in C++. By using our own JS-implemented Quick Sort (below), we get
// a ~3500ms mean speed-up in `bench/bench.html`.

/**
 * Swap the elements indexed by `x` and `y` in the array `ary`.
 *
 * @param {Array} ary
 *        The array.
 * @param {Number} x
 *        The index of the first item.
 * @param {Number} y
 *        The index of the second item.
 */
function swap(ary, x, y) {
  var temp = ary[x];
  ary[x] = ary[y];
  ary[y] = temp;
}

/**
 * Returns a random integer within the range `low .. high` inclusive.
 *
 * @param {Number} low
 *        The lower bound on the range.
 * @param {Number} high
 *        The upper bound on the range.
 */
function randomIntInRange(low, high) {
  return Math.round(low + (Math.random() * (high - low)));
}

/**
 * The Quick Sort algorithm.
 *
 * @param {Array} ary
 *        An array to sort.
 * @param {function} comparator
 *        Function to use to compare two items.
 * @param {Number} p
 *        Start index of the array
 * @param {Number} r
 *        End index of the array
 */
function doQuickSort(ary, comparator, p, r) {
  // If our lower bound is less than our upper bound, we (1) partition the
  // array into two pieces and (2) recurse on each half. If it is not, this is
  // the empty array and our base case.

  if (p < r) {
    // (1) Partitioning.
    //
    // The partitioning chooses a pivot between `p` and `r` and moves all
    // elements that are less than or equal to the pivot to the before it, and
    // all the elements that are greater than it after it. The effect is that
    // once partition is done, the pivot is in the exact place it will be when
    // the array is put in sorted order, and it will not need to be moved
    // again. This runs in O(n) time.

    // Always choose a random pivot so that an input array which is reverse
    // sorted does not cause O(n^2) running time.
    var pivotIndex = randomIntInRange(p, r);
    var i = p - 1;

    swap(ary, pivotIndex, r);
    var pivot = ary[r];

    // Immediately after `j` is incremented in this loop, the following hold
    // true:
    //
    //   * Every element in `ary[p .. i]` is less than or equal to the pivot.
    //
    //   * Every element in `ary[i+1 .. j-1]` is greater than the pivot.
    for (var j = p; j < r; j++) {
      if (comparator(ary[j], pivot) <= 0) {
        i += 1;
        swap(ary, i, j);
      }
    }

    swap(ary, i + 1, j);
    var q = i + 1;

    // (2) Recurse on each half.

    doQuickSort(ary, comparator, p, q - 1);
    doQuickSort(ary, comparator, q + 1, r);
  }
}

/**
 * Sort the given array in-place with the given comparator function.
 *
 * @param {Array} ary
 *        An array to sort.
 * @param {function} comparator
 *        Function to use to compare two items.
 */
quickSort$1.quickSort = function (ary, comparator) {
  doQuickSort(ary, comparator, 0, ary.length - 1);
};

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var util$1 = util$5;
var binarySearch = binarySearch$1;
var ArraySet = arraySet.ArraySet;
var base64VLQ = base64Vlq;
var quickSort = quickSort$1.quickSort;

function SourceMapConsumer$1(aSourceMap, aSourceMapURL) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util$1.parseSourceMapInput(aSourceMap);
  }

  return sourceMap.sections != null
    ? new IndexedSourceMapConsumer(sourceMap, aSourceMapURL)
    : new BasicSourceMapConsumer(sourceMap, aSourceMapURL);
}

SourceMapConsumer$1.fromSourceMap = function(aSourceMap, aSourceMapURL) {
  return BasicSourceMapConsumer.fromSourceMap(aSourceMap, aSourceMapURL);
};

/**
 * The version of the source mapping spec that we are consuming.
 */
SourceMapConsumer$1.prototype._version = 3;

// `__generatedMappings` and `__originalMappings` are arrays that hold the
// parsed mapping coordinates from the source map's "mappings" attribute. They
// are lazily instantiated, accessed via the `_generatedMappings` and
// `_originalMappings` getters respectively, and we only parse the mappings
// and create these arrays once queried for a source location. We jump through
// these hoops because there can be many thousands of mappings, and parsing
// them is expensive, so we only want to do it if we must.
//
// Each object in the arrays is of the form:
//
//     {
//       generatedLine: The line number in the generated code,
//       generatedColumn: The column number in the generated code,
//       source: The path to the original source file that generated this
//               chunk of code,
//       originalLine: The line number in the original source that
//                     corresponds to this chunk of generated code,
//       originalColumn: The column number in the original source that
//                       corresponds to this chunk of generated code,
//       name: The name of the original symbol which generated this chunk of
//             code.
//     }
//
// All properties except for `generatedLine` and `generatedColumn` can be
// `null`.
//
// `_generatedMappings` is ordered by the generated positions.
//
// `_originalMappings` is ordered by the original positions.

SourceMapConsumer$1.prototype.__generatedMappings = null;
Object.defineProperty(SourceMapConsumer$1.prototype, '_generatedMappings', {
  configurable: true,
  enumerable: true,
  get: function () {
    if (!this.__generatedMappings) {
      this._parseMappings(this._mappings, this.sourceRoot);
    }

    return this.__generatedMappings;
  }
});

SourceMapConsumer$1.prototype.__originalMappings = null;
Object.defineProperty(SourceMapConsumer$1.prototype, '_originalMappings', {
  configurable: true,
  enumerable: true,
  get: function () {
    if (!this.__originalMappings) {
      this._parseMappings(this._mappings, this.sourceRoot);
    }

    return this.__originalMappings;
  }
});

SourceMapConsumer$1.prototype._charIsMappingSeparator =
  function SourceMapConsumer_charIsMappingSeparator(aStr, index) {
    var c = aStr.charAt(index);
    return c === ";" || c === ",";
  };

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
SourceMapConsumer$1.prototype._parseMappings =
  function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
    throw new Error("Subclasses must implement _parseMappings");
  };

SourceMapConsumer$1.GENERATED_ORDER = 1;
SourceMapConsumer$1.ORIGINAL_ORDER = 2;

SourceMapConsumer$1.GREATEST_LOWER_BOUND = 1;
SourceMapConsumer$1.LEAST_UPPER_BOUND = 2;

/**
 * Iterate over each mapping between an original source/line/column and a
 * generated line/column in this source map.
 *
 * @param Function aCallback
 *        The function that is called with each mapping.
 * @param Object aContext
 *        Optional. If specified, this object will be the value of `this` every
 *        time that `aCallback` is called.
 * @param aOrder
 *        Either `SourceMapConsumer.GENERATED_ORDER` or
 *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
 *        iterate over the mappings sorted by the generated file's line/column
 *        order or the original's source/line/column order, respectively. Defaults to
 *        `SourceMapConsumer.GENERATED_ORDER`.
 */
SourceMapConsumer$1.prototype.eachMapping =
  function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
    var context = aContext || null;
    var order = aOrder || SourceMapConsumer$1.GENERATED_ORDER;

    var mappings;
    switch (order) {
    case SourceMapConsumer$1.GENERATED_ORDER:
      mappings = this._generatedMappings;
      break;
    case SourceMapConsumer$1.ORIGINAL_ORDER:
      mappings = this._originalMappings;
      break;
    default:
      throw new Error("Unknown order of iteration.");
    }

    var sourceRoot = this.sourceRoot;
    mappings.map(function (mapping) {
      var source = mapping.source === null ? null : this._sources.at(mapping.source);
      source = util$1.computeSourceURL(sourceRoot, source, this._sourceMapURL);
      return {
        source: source,
        generatedLine: mapping.generatedLine,
        generatedColumn: mapping.generatedColumn,
        originalLine: mapping.originalLine,
        originalColumn: mapping.originalColumn,
        name: mapping.name === null ? null : this._names.at(mapping.name)
      };
    }, this).forEach(aCallback, context);
  };

/**
 * Returns all generated line and column information for the original source,
 * line, and column provided. If no column is provided, returns all mappings
 * corresponding to a either the line we are searching for or the next
 * closest line that has any mappings. Otherwise, returns all mappings
 * corresponding to the given line and either the column we are searching for
 * or the next closest column that has any offsets.
 *
 * The only argument is an object with the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number is 1-based.
 *   - column: Optional. the column number in the original source.
 *    The column number is 0-based.
 *
 * and an array of objects is returned, each with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *    line number is 1-based.
 *   - column: The column number in the generated source, or null.
 *    The column number is 0-based.
 */
SourceMapConsumer$1.prototype.allGeneratedPositionsFor =
  function SourceMapConsumer_allGeneratedPositionsFor(aArgs) {
    var line = util$1.getArg(aArgs, 'line');

    // When there is no exact match, BasicSourceMapConsumer.prototype._findMapping
    // returns the index of the closest mapping less than the needle. By
    // setting needle.originalColumn to 0, we thus find the last mapping for
    // the given line, provided such a mapping exists.
    var needle = {
      source: util$1.getArg(aArgs, 'source'),
      originalLine: line,
      originalColumn: util$1.getArg(aArgs, 'column', 0)
    };

    needle.source = this._findSourceIndex(needle.source);
    if (needle.source < 0) {
      return [];
    }

    var mappings = [];

    var index = this._findMapping(needle,
                                  this._originalMappings,
                                  "originalLine",
                                  "originalColumn",
                                  util$1.compareByOriginalPositions,
                                  binarySearch.LEAST_UPPER_BOUND);
    if (index >= 0) {
      var mapping = this._originalMappings[index];

      if (aArgs.column === undefined) {
        var originalLine = mapping.originalLine;

        // Iterate until either we run out of mappings, or we run into
        // a mapping for a different line than the one we found. Since
        // mappings are sorted, this is guaranteed to find all mappings for
        // the line we found.
        while (mapping && mapping.originalLine === originalLine) {
          mappings.push({
            line: util$1.getArg(mapping, 'generatedLine', null),
            column: util$1.getArg(mapping, 'generatedColumn', null),
            lastColumn: util$1.getArg(mapping, 'lastGeneratedColumn', null)
          });

          mapping = this._originalMappings[++index];
        }
      } else {
        var originalColumn = mapping.originalColumn;

        // Iterate until either we run out of mappings, or we run into
        // a mapping for a different line than the one we were searching for.
        // Since mappings are sorted, this is guaranteed to find all mappings for
        // the line we are searching for.
        while (mapping &&
               mapping.originalLine === line &&
               mapping.originalColumn == originalColumn) {
          mappings.push({
            line: util$1.getArg(mapping, 'generatedLine', null),
            column: util$1.getArg(mapping, 'generatedColumn', null),
            lastColumn: util$1.getArg(mapping, 'lastGeneratedColumn', null)
          });

          mapping = this._originalMappings[++index];
        }
      }
    }

    return mappings;
  };

sourceMapConsumer.SourceMapConsumer = SourceMapConsumer$1;

/**
 * A BasicSourceMapConsumer instance represents a parsed source map which we can
 * query for information about the original file positions by giving it a file
 * position in the generated source.
 *
 * The first parameter is the raw source map (either as a JSON string, or
 * already parsed to an object). According to the spec, source maps have the
 * following attributes:
 *
 *   - version: Which version of the source map spec this map is following.
 *   - sources: An array of URLs to the original source files.
 *   - names: An array of identifiers which can be referrenced by individual mappings.
 *   - sourceRoot: Optional. The URL root from which all sources are relative.
 *   - sourcesContent: Optional. An array of contents of the original source files.
 *   - mappings: A string of base64 VLQs which contain the actual mappings.
 *   - file: Optional. The generated file this source map is associated with.
 *
 * Here is an example source map, taken from the source map spec[0]:
 *
 *     {
 *       version : 3,
 *       file: "out.js",
 *       sourceRoot : "",
 *       sources: ["foo.js", "bar.js"],
 *       names: ["src", "maps", "are", "fun"],
 *       mappings: "AA,AB;;ABCDE;"
 *     }
 *
 * The second parameter, if given, is a string whose value is the URL
 * at which the source map was found.  This URL is used to compute the
 * sources array.
 *
 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
 */
function BasicSourceMapConsumer(aSourceMap, aSourceMapURL) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util$1.parseSourceMapInput(aSourceMap);
  }

  var version = util$1.getArg(sourceMap, 'version');
  var sources = util$1.getArg(sourceMap, 'sources');
  // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
  // requires the array) to play nice here.
  var names = util$1.getArg(sourceMap, 'names', []);
  var sourceRoot = util$1.getArg(sourceMap, 'sourceRoot', null);
  var sourcesContent = util$1.getArg(sourceMap, 'sourcesContent', null);
  var mappings = util$1.getArg(sourceMap, 'mappings');
  var file = util$1.getArg(sourceMap, 'file', null);

  // Once again, Sass deviates from the spec and supplies the version as a
  // string rather than a number, so we use loose equality checking here.
  if (version != this._version) {
    throw new Error('Unsupported version: ' + version);
  }

  if (sourceRoot) {
    sourceRoot = util$1.normalize(sourceRoot);
  }

  sources = sources
    .map(String)
    // Some source maps produce relative source paths like "./foo.js" instead of
    // "foo.js".  Normalize these first so that future comparisons will succeed.
    // See bugzil.la/1090768.
    .map(util$1.normalize)
    // Always ensure that absolute sources are internally stored relative to
    // the source root, if the source root is absolute. Not doing this would
    // be particularly problematic when the source root is a prefix of the
    // source (valid, but why??). See github issue #199 and bugzil.la/1188982.
    .map(function (source) {
      return sourceRoot && util$1.isAbsolute(sourceRoot) && util$1.isAbsolute(source)
        ? util$1.relative(sourceRoot, source)
        : source;
    });

  // Pass `true` below to allow duplicate names and sources. While source maps
  // are intended to be compressed and deduplicated, the TypeScript compiler
  // sometimes generates source maps with duplicates in them. See Github issue
  // #72 and bugzil.la/889492.
  this._names = ArraySet.fromArray(names.map(String), true);
  this._sources = ArraySet.fromArray(sources, true);

  this._absoluteSources = this._sources.toArray().map(function (s) {
    return util$1.computeSourceURL(sourceRoot, s, aSourceMapURL);
  });

  this.sourceRoot = sourceRoot;
  this.sourcesContent = sourcesContent;
  this._mappings = mappings;
  this._sourceMapURL = aSourceMapURL;
  this.file = file;
}

BasicSourceMapConsumer.prototype = Object.create(SourceMapConsumer$1.prototype);
BasicSourceMapConsumer.prototype.consumer = SourceMapConsumer$1;

/**
 * Utility function to find the index of a source.  Returns -1 if not
 * found.
 */
BasicSourceMapConsumer.prototype._findSourceIndex = function(aSource) {
  var relativeSource = aSource;
  if (this.sourceRoot != null) {
    relativeSource = util$1.relative(this.sourceRoot, relativeSource);
  }

  if (this._sources.has(relativeSource)) {
    return this._sources.indexOf(relativeSource);
  }

  // Maybe aSource is an absolute URL as returned by |sources|.  In
  // this case we can't simply undo the transform.
  var i;
  for (i = 0; i < this._absoluteSources.length; ++i) {
    if (this._absoluteSources[i] == aSource) {
      return i;
    }
  }

  return -1;
};

/**
 * Create a BasicSourceMapConsumer from a SourceMapGenerator.
 *
 * @param SourceMapGenerator aSourceMap
 *        The source map that will be consumed.
 * @param String aSourceMapURL
 *        The URL at which the source map can be found (optional)
 * @returns BasicSourceMapConsumer
 */
BasicSourceMapConsumer.fromSourceMap =
  function SourceMapConsumer_fromSourceMap(aSourceMap, aSourceMapURL) {
    var smc = Object.create(BasicSourceMapConsumer.prototype);

    var names = smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
    var sources = smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
    smc.sourceRoot = aSourceMap._sourceRoot;
    smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                            smc.sourceRoot);
    smc.file = aSourceMap._file;
    smc._sourceMapURL = aSourceMapURL;
    smc._absoluteSources = smc._sources.toArray().map(function (s) {
      return util$1.computeSourceURL(smc.sourceRoot, s, aSourceMapURL);
    });

    // Because we are modifying the entries (by converting string sources and
    // names to indices into the sources and names ArraySets), we have to make
    // a copy of the entry or else bad things happen. Shared mutable state
    // strikes again! See github issue #191.

    var generatedMappings = aSourceMap._mappings.toArray().slice();
    var destGeneratedMappings = smc.__generatedMappings = [];
    var destOriginalMappings = smc.__originalMappings = [];

    for (var i = 0, length = generatedMappings.length; i < length; i++) {
      var srcMapping = generatedMappings[i];
      var destMapping = new Mapping;
      destMapping.generatedLine = srcMapping.generatedLine;
      destMapping.generatedColumn = srcMapping.generatedColumn;

      if (srcMapping.source) {
        destMapping.source = sources.indexOf(srcMapping.source);
        destMapping.originalLine = srcMapping.originalLine;
        destMapping.originalColumn = srcMapping.originalColumn;

        if (srcMapping.name) {
          destMapping.name = names.indexOf(srcMapping.name);
        }

        destOriginalMappings.push(destMapping);
      }

      destGeneratedMappings.push(destMapping);
    }

    quickSort(smc.__originalMappings, util$1.compareByOriginalPositions);

    return smc;
  };

/**
 * The version of the source mapping spec that we are consuming.
 */
BasicSourceMapConsumer.prototype._version = 3;

/**
 * The list of original sources.
 */
Object.defineProperty(BasicSourceMapConsumer.prototype, 'sources', {
  get: function () {
    return this._absoluteSources.slice();
  }
});

/**
 * Provide the JIT with a nice shape / hidden class.
 */
function Mapping() {
  this.generatedLine = 0;
  this.generatedColumn = 0;
  this.source = null;
  this.originalLine = null;
  this.originalColumn = null;
  this.name = null;
}

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
BasicSourceMapConsumer.prototype._parseMappings =
  function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
    var generatedLine = 1;
    var previousGeneratedColumn = 0;
    var previousOriginalLine = 0;
    var previousOriginalColumn = 0;
    var previousSource = 0;
    var previousName = 0;
    var length = aStr.length;
    var index = 0;
    var cachedSegments = {};
    var temp = {};
    var originalMappings = [];
    var generatedMappings = [];
    var mapping, str, segment, end, value;

    while (index < length) {
      if (aStr.charAt(index) === ';') {
        generatedLine++;
        index++;
        previousGeneratedColumn = 0;
      }
      else if (aStr.charAt(index) === ',') {
        index++;
      }
      else {
        mapping = new Mapping();
        mapping.generatedLine = generatedLine;

        // Because each offset is encoded relative to the previous one,
        // many segments often have the same encoding. We can exploit this
        // fact by caching the parsed variable length fields of each segment,
        // allowing us to avoid a second parse if we encounter the same
        // segment again.
        for (end = index; end < length; end++) {
          if (this._charIsMappingSeparator(aStr, end)) {
            break;
          }
        }
        str = aStr.slice(index, end);

        segment = cachedSegments[str];
        if (segment) {
          index += str.length;
        } else {
          segment = [];
          while (index < end) {
            base64VLQ.decode(aStr, index, temp);
            value = temp.value;
            index = temp.rest;
            segment.push(value);
          }

          if (segment.length === 2) {
            throw new Error('Found a source, but no line and column');
          }

          if (segment.length === 3) {
            throw new Error('Found a source and line, but no column');
          }

          cachedSegments[str] = segment;
        }

        // Generated column.
        mapping.generatedColumn = previousGeneratedColumn + segment[0];
        previousGeneratedColumn = mapping.generatedColumn;

        if (segment.length > 1) {
          // Original source.
          mapping.source = previousSource + segment[1];
          previousSource += segment[1];

          // Original line.
          mapping.originalLine = previousOriginalLine + segment[2];
          previousOriginalLine = mapping.originalLine;
          // Lines are stored 0-based
          mapping.originalLine += 1;

          // Original column.
          mapping.originalColumn = previousOriginalColumn + segment[3];
          previousOriginalColumn = mapping.originalColumn;

          if (segment.length > 4) {
            // Original name.
            mapping.name = previousName + segment[4];
            previousName += segment[4];
          }
        }

        generatedMappings.push(mapping);
        if (typeof mapping.originalLine === 'number') {
          originalMappings.push(mapping);
        }
      }
    }

    quickSort(generatedMappings, util$1.compareByGeneratedPositionsDeflated);
    this.__generatedMappings = generatedMappings;

    quickSort(originalMappings, util$1.compareByOriginalPositions);
    this.__originalMappings = originalMappings;
  };

/**
 * Find the mapping that best matches the hypothetical "needle" mapping that
 * we are searching for in the given "haystack" of mappings.
 */
BasicSourceMapConsumer.prototype._findMapping =
  function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                         aColumnName, aComparator, aBias) {
    // To return the position we are searching for, we must first find the
    // mapping for the given position and then return the opposite position it
    // points to. Because the mappings are sorted, we can use binary search to
    // find the best mapping.

    if (aNeedle[aLineName] <= 0) {
      throw new TypeError('Line must be greater than or equal to 1, got '
                          + aNeedle[aLineName]);
    }
    if (aNeedle[aColumnName] < 0) {
      throw new TypeError('Column must be greater than or equal to 0, got '
                          + aNeedle[aColumnName]);
    }

    return binarySearch.search(aNeedle, aMappings, aComparator, aBias);
  };

/**
 * Compute the last column for each generated mapping. The last column is
 * inclusive.
 */
BasicSourceMapConsumer.prototype.computeColumnSpans =
  function SourceMapConsumer_computeColumnSpans() {
    for (var index = 0; index < this._generatedMappings.length; ++index) {
      var mapping = this._generatedMappings[index];

      // Mappings do not contain a field for the last generated columnt. We
      // can come up with an optimistic estimate, however, by assuming that
      // mappings are contiguous (i.e. given two consecutive mappings, the
      // first mapping ends where the second one starts).
      if (index + 1 < this._generatedMappings.length) {
        var nextMapping = this._generatedMappings[index + 1];

        if (mapping.generatedLine === nextMapping.generatedLine) {
          mapping.lastGeneratedColumn = nextMapping.generatedColumn - 1;
          continue;
        }
      }

      // The last mapping for each line spans the entire line.
      mapping.lastGeneratedColumn = Infinity;
    }
  };

/**
 * Returns the original source, line, and column information for the generated
 * source's line and column positions provided. The only argument is an object
 * with the following properties:
 *
 *   - line: The line number in the generated source.  The line number
 *     is 1-based.
 *   - column: The column number in the generated source.  The column
 *     number is 0-based.
 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
 *     closest element that is smaller than or greater than the one we are
 *     searching for, respectively, if the exact element cannot be found.
 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
 *
 * and an object is returned with the following properties:
 *
 *   - source: The original source file, or null.
 *   - line: The line number in the original source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the original source, or null.  The
 *     column number is 0-based.
 *   - name: The original identifier, or null.
 */
BasicSourceMapConsumer.prototype.originalPositionFor =
  function SourceMapConsumer_originalPositionFor(aArgs) {
    var needle = {
      generatedLine: util$1.getArg(aArgs, 'line'),
      generatedColumn: util$1.getArg(aArgs, 'column')
    };

    var index = this._findMapping(
      needle,
      this._generatedMappings,
      "generatedLine",
      "generatedColumn",
      util$1.compareByGeneratedPositionsDeflated,
      util$1.getArg(aArgs, 'bias', SourceMapConsumer$1.GREATEST_LOWER_BOUND)
    );

    if (index >= 0) {
      var mapping = this._generatedMappings[index];

      if (mapping.generatedLine === needle.generatedLine) {
        var source = util$1.getArg(mapping, 'source', null);
        if (source !== null) {
          source = this._sources.at(source);
          source = util$1.computeSourceURL(this.sourceRoot, source, this._sourceMapURL);
        }
        var name = util$1.getArg(mapping, 'name', null);
        if (name !== null) {
          name = this._names.at(name);
        }
        return {
          source: source,
          line: util$1.getArg(mapping, 'originalLine', null),
          column: util$1.getArg(mapping, 'originalColumn', null),
          name: name
        };
      }
    }

    return {
      source: null,
      line: null,
      column: null,
      name: null
    };
  };

/**
 * Return true if we have the source content for every source in the source
 * map, false otherwise.
 */
BasicSourceMapConsumer.prototype.hasContentsOfAllSources =
  function BasicSourceMapConsumer_hasContentsOfAllSources() {
    if (!this.sourcesContent) {
      return false;
    }
    return this.sourcesContent.length >= this._sources.size() &&
      !this.sourcesContent.some(function (sc) { return sc == null; });
  };

/**
 * Returns the original source content. The only argument is the url of the
 * original source file. Returns null if no original source content is
 * available.
 */
BasicSourceMapConsumer.prototype.sourceContentFor =
  function SourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
    if (!this.sourcesContent) {
      return null;
    }

    var index = this._findSourceIndex(aSource);
    if (index >= 0) {
      return this.sourcesContent[index];
    }

    var relativeSource = aSource;
    if (this.sourceRoot != null) {
      relativeSource = util$1.relative(this.sourceRoot, relativeSource);
    }

    var url;
    if (this.sourceRoot != null
        && (url = util$1.urlParse(this.sourceRoot))) {
      // XXX: file:// URIs and absolute paths lead to unexpected behavior for
      // many users. We can help them out when they expect file:// URIs to
      // behave like it would if they were running a local HTTP server. See
      // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
      var fileUriAbsPath = relativeSource.replace(/^file:\/\//, "");
      if (url.scheme == "file"
          && this._sources.has(fileUriAbsPath)) {
        return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
      }

      if ((!url.path || url.path == "/")
          && this._sources.has("/" + relativeSource)) {
        return this.sourcesContent[this._sources.indexOf("/" + relativeSource)];
      }
    }

    // This function is used recursively from
    // IndexedSourceMapConsumer.prototype.sourceContentFor. In that case, we
    // don't want to throw if we can't find the source - we just want to
    // return null, so we provide a flag to exit gracefully.
    if (nullOnMissing) {
      return null;
    }
    else {
      throw new Error('"' + relativeSource + '" is not in the SourceMap.');
    }
  };

/**
 * Returns the generated line and column information for the original source,
 * line, and column positions provided. The only argument is an object with
 * the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number
 *     is 1-based.
 *   - column: The column number in the original source.  The column
 *     number is 0-based.
 *   - bias: Either 'SourceMapConsumer.GREATEST_LOWER_BOUND' or
 *     'SourceMapConsumer.LEAST_UPPER_BOUND'. Specifies whether to return the
 *     closest element that is smaller than or greater than the one we are
 *     searching for, respectively, if the exact element cannot be found.
 *     Defaults to 'SourceMapConsumer.GREATEST_LOWER_BOUND'.
 *
 * and an object is returned with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the generated source, or null.
 *     The column number is 0-based.
 */
BasicSourceMapConsumer.prototype.generatedPositionFor =
  function SourceMapConsumer_generatedPositionFor(aArgs) {
    var source = util$1.getArg(aArgs, 'source');
    source = this._findSourceIndex(source);
    if (source < 0) {
      return {
        line: null,
        column: null,
        lastColumn: null
      };
    }

    var needle = {
      source: source,
      originalLine: util$1.getArg(aArgs, 'line'),
      originalColumn: util$1.getArg(aArgs, 'column')
    };

    var index = this._findMapping(
      needle,
      this._originalMappings,
      "originalLine",
      "originalColumn",
      util$1.compareByOriginalPositions,
      util$1.getArg(aArgs, 'bias', SourceMapConsumer$1.GREATEST_LOWER_BOUND)
    );

    if (index >= 0) {
      var mapping = this._originalMappings[index];

      if (mapping.source === needle.source) {
        return {
          line: util$1.getArg(mapping, 'generatedLine', null),
          column: util$1.getArg(mapping, 'generatedColumn', null),
          lastColumn: util$1.getArg(mapping, 'lastGeneratedColumn', null)
        };
      }
    }

    return {
      line: null,
      column: null,
      lastColumn: null
    };
  };

sourceMapConsumer.BasicSourceMapConsumer = BasicSourceMapConsumer;

/**
 * An IndexedSourceMapConsumer instance represents a parsed source map which
 * we can query for information. It differs from BasicSourceMapConsumer in
 * that it takes "indexed" source maps (i.e. ones with a "sections" field) as
 * input.
 *
 * The first parameter is a raw source map (either as a JSON string, or already
 * parsed to an object). According to the spec for indexed source maps, they
 * have the following attributes:
 *
 *   - version: Which version of the source map spec this map is following.
 *   - file: Optional. The generated file this source map is associated with.
 *   - sections: A list of section definitions.
 *
 * Each value under the "sections" field has two fields:
 *   - offset: The offset into the original specified at which this section
 *       begins to apply, defined as an object with a "line" and "column"
 *       field.
 *   - map: A source map definition. This source map could also be indexed,
 *       but doesn't have to be.
 *
 * Instead of the "map" field, it's also possible to have a "url" field
 * specifying a URL to retrieve a source map from, but that's currently
 * unsupported.
 *
 * Here's an example source map, taken from the source map spec[0], but
 * modified to omit a section which uses the "url" field.
 *
 *  {
 *    version : 3,
 *    file: "app.js",
 *    sections: [{
 *      offset: {line:100, column:10},
 *      map: {
 *        version : 3,
 *        file: "section.js",
 *        sources: ["foo.js", "bar.js"],
 *        names: ["src", "maps", "are", "fun"],
 *        mappings: "AAAA,E;;ABCDE;"
 *      }
 *    }],
 *  }
 *
 * The second parameter, if given, is a string whose value is the URL
 * at which the source map was found.  This URL is used to compute the
 * sources array.
 *
 * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#heading=h.535es3xeprgt
 */
function IndexedSourceMapConsumer(aSourceMap, aSourceMapURL) {
  var sourceMap = aSourceMap;
  if (typeof aSourceMap === 'string') {
    sourceMap = util$1.parseSourceMapInput(aSourceMap);
  }

  var version = util$1.getArg(sourceMap, 'version');
  var sections = util$1.getArg(sourceMap, 'sections');

  if (version != this._version) {
    throw new Error('Unsupported version: ' + version);
  }

  this._sources = new ArraySet();
  this._names = new ArraySet();

  var lastOffset = {
    line: -1,
    column: 0
  };
  this._sections = sections.map(function (s) {
    if (s.url) {
      // The url field will require support for asynchronicity.
      // See https://github.com/mozilla/source-map/issues/16
      throw new Error('Support for url field in sections not implemented.');
    }
    var offset = util$1.getArg(s, 'offset');
    var offsetLine = util$1.getArg(offset, 'line');
    var offsetColumn = util$1.getArg(offset, 'column');

    if (offsetLine < lastOffset.line ||
        (offsetLine === lastOffset.line && offsetColumn < lastOffset.column)) {
      throw new Error('Section offsets must be ordered and non-overlapping.');
    }
    lastOffset = offset;

    return {
      generatedOffset: {
        // The offset fields are 0-based, but we use 1-based indices when
        // encoding/decoding from VLQ.
        generatedLine: offsetLine + 1,
        generatedColumn: offsetColumn + 1
      },
      consumer: new SourceMapConsumer$1(util$1.getArg(s, 'map'), aSourceMapURL)
    }
  });
}

IndexedSourceMapConsumer.prototype = Object.create(SourceMapConsumer$1.prototype);
IndexedSourceMapConsumer.prototype.constructor = SourceMapConsumer$1;

/**
 * The version of the source mapping spec that we are consuming.
 */
IndexedSourceMapConsumer.prototype._version = 3;

/**
 * The list of original sources.
 */
Object.defineProperty(IndexedSourceMapConsumer.prototype, 'sources', {
  get: function () {
    var sources = [];
    for (var i = 0; i < this._sections.length; i++) {
      for (var j = 0; j < this._sections[i].consumer.sources.length; j++) {
        sources.push(this._sections[i].consumer.sources[j]);
      }
    }
    return sources;
  }
});

/**
 * Returns the original source, line, and column information for the generated
 * source's line and column positions provided. The only argument is an object
 * with the following properties:
 *
 *   - line: The line number in the generated source.  The line number
 *     is 1-based.
 *   - column: The column number in the generated source.  The column
 *     number is 0-based.
 *
 * and an object is returned with the following properties:
 *
 *   - source: The original source file, or null.
 *   - line: The line number in the original source, or null.  The
 *     line number is 1-based.
 *   - column: The column number in the original source, or null.  The
 *     column number is 0-based.
 *   - name: The original identifier, or null.
 */
IndexedSourceMapConsumer.prototype.originalPositionFor =
  function IndexedSourceMapConsumer_originalPositionFor(aArgs) {
    var needle = {
      generatedLine: util$1.getArg(aArgs, 'line'),
      generatedColumn: util$1.getArg(aArgs, 'column')
    };

    // Find the section containing the generated position we're trying to map
    // to an original position.
    var sectionIndex = binarySearch.search(needle, this._sections,
      function(needle, section) {
        var cmp = needle.generatedLine - section.generatedOffset.generatedLine;
        if (cmp) {
          return cmp;
        }

        return (needle.generatedColumn -
                section.generatedOffset.generatedColumn);
      });
    var section = this._sections[sectionIndex];

    if (!section) {
      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    }

    return section.consumer.originalPositionFor({
      line: needle.generatedLine -
        (section.generatedOffset.generatedLine - 1),
      column: needle.generatedColumn -
        (section.generatedOffset.generatedLine === needle.generatedLine
         ? section.generatedOffset.generatedColumn - 1
         : 0),
      bias: aArgs.bias
    });
  };

/**
 * Return true if we have the source content for every source in the source
 * map, false otherwise.
 */
IndexedSourceMapConsumer.prototype.hasContentsOfAllSources =
  function IndexedSourceMapConsumer_hasContentsOfAllSources() {
    return this._sections.every(function (s) {
      return s.consumer.hasContentsOfAllSources();
    });
  };

/**
 * Returns the original source content. The only argument is the url of the
 * original source file. Returns null if no original source content is
 * available.
 */
IndexedSourceMapConsumer.prototype.sourceContentFor =
  function IndexedSourceMapConsumer_sourceContentFor(aSource, nullOnMissing) {
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];

      var content = section.consumer.sourceContentFor(aSource, true);
      if (content) {
        return content;
      }
    }
    if (nullOnMissing) {
      return null;
    }
    else {
      throw new Error('"' + aSource + '" is not in the SourceMap.');
    }
  };

/**
 * Returns the generated line and column information for the original source,
 * line, and column positions provided. The only argument is an object with
 * the following properties:
 *
 *   - source: The filename of the original source.
 *   - line: The line number in the original source.  The line number
 *     is 1-based.
 *   - column: The column number in the original source.  The column
 *     number is 0-based.
 *
 * and an object is returned with the following properties:
 *
 *   - line: The line number in the generated source, or null.  The
 *     line number is 1-based. 
 *   - column: The column number in the generated source, or null.
 *     The column number is 0-based.
 */
IndexedSourceMapConsumer.prototype.generatedPositionFor =
  function IndexedSourceMapConsumer_generatedPositionFor(aArgs) {
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];

      // Only consider this section if the requested source is in the list of
      // sources of the consumer.
      if (section.consumer._findSourceIndex(util$1.getArg(aArgs, 'source')) === -1) {
        continue;
      }
      var generatedPosition = section.consumer.generatedPositionFor(aArgs);
      if (generatedPosition) {
        var ret = {
          line: generatedPosition.line +
            (section.generatedOffset.generatedLine - 1),
          column: generatedPosition.column +
            (section.generatedOffset.generatedLine === generatedPosition.line
             ? section.generatedOffset.generatedColumn - 1
             : 0)
        };
        return ret;
      }
    }

    return {
      line: null,
      column: null
    };
  };

/**
 * Parse the mappings in a string in to a data structure which we can easily
 * query (the ordered arrays in the `this.__generatedMappings` and
 * `this.__originalMappings` properties).
 */
IndexedSourceMapConsumer.prototype._parseMappings =
  function IndexedSourceMapConsumer_parseMappings(aStr, aSourceRoot) {
    this.__generatedMappings = [];
    this.__originalMappings = [];
    for (var i = 0; i < this._sections.length; i++) {
      var section = this._sections[i];
      var sectionMappings = section.consumer._generatedMappings;
      for (var j = 0; j < sectionMappings.length; j++) {
        var mapping = sectionMappings[j];

        var source = section.consumer._sources.at(mapping.source);
        source = util$1.computeSourceURL(section.consumer.sourceRoot, source, this._sourceMapURL);
        this._sources.add(source);
        source = this._sources.indexOf(source);

        var name = null;
        if (mapping.name) {
          name = section.consumer._names.at(mapping.name);
          this._names.add(name);
          name = this._names.indexOf(name);
        }

        // The mappings coming from the consumer for the section have
        // generated positions relative to the start of the section, so we
        // need to offset them to be relative to the start of the concatenated
        // generated file.
        var adjustedMapping = {
          source: source,
          generatedLine: mapping.generatedLine +
            (section.generatedOffset.generatedLine - 1),
          generatedColumn: mapping.generatedColumn +
            (section.generatedOffset.generatedLine === mapping.generatedLine
            ? section.generatedOffset.generatedColumn - 1
            : 0),
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: name
        };

        this.__generatedMappings.push(adjustedMapping);
        if (typeof adjustedMapping.originalLine === 'number') {
          this.__originalMappings.push(adjustedMapping);
        }
      }
    }

    quickSort(this.__generatedMappings, util$1.compareByGeneratedPositionsDeflated);
    quickSort(this.__originalMappings, util$1.compareByOriginalPositions);
  };

sourceMapConsumer.IndexedSourceMapConsumer = IndexedSourceMapConsumer;

/* -*- Mode: js; js-indent-level: 2; -*- */

/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */

var SourceMapGenerator = sourceMapGenerator.SourceMapGenerator;
var util = util$5;

// Matches a Windows-style `\r\n` newline or a `\n` newline used by all other
// operating systems these days (capturing the result).
var REGEX_NEWLINE = /(\r?\n)/;

// Newline character code for charCodeAt() comparisons
var NEWLINE_CODE = 10;

// Private symbol for identifying `SourceNode`s when multiple versions of
// the source-map library are loaded. This MUST NOT CHANGE across
// versions!
var isSourceNode = "$$$isSourceNode$$$";

/**
 * SourceNodes provide a way to abstract over interpolating/concatenating
 * snippets of generated JavaScript source code while maintaining the line and
 * column information associated with the original source code.
 *
 * @param aLine The original line number.
 * @param aColumn The original column number.
 * @param aSource The original source's filename.
 * @param aChunks Optional. An array of strings which are snippets of
 *        generated JS, or other SourceNodes.
 * @param aName The original identifier.
 */
function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
  this.children = [];
  this.sourceContents = {};
  this.line = aLine == null ? null : aLine;
  this.column = aColumn == null ? null : aColumn;
  this.source = aSource == null ? null : aSource;
  this.name = aName == null ? null : aName;
  this[isSourceNode] = true;
  if (aChunks != null) this.add(aChunks);
}

/**
 * Creates a SourceNode from generated code and a SourceMapConsumer.
 *
 * @param aGeneratedCode The generated code
 * @param aSourceMapConsumer The SourceMap for the generated code
 * @param aRelativePath Optional. The path that relative sources in the
 *        SourceMapConsumer should be relative to.
 */
SourceNode.fromStringWithSourceMap =
  function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer, aRelativePath) {
    // The SourceNode we want to fill with the generated code
    // and the SourceMap
    var node = new SourceNode();

    // All even indices of this array are one line of the generated code,
    // while all odd indices are the newlines between two adjacent lines
    // (since `REGEX_NEWLINE` captures its match).
    // Processed fragments are accessed by calling `shiftNextLine`.
    var remainingLines = aGeneratedCode.split(REGEX_NEWLINE);
    var remainingLinesIndex = 0;
    var shiftNextLine = function() {
      var lineContents = getNextLine();
      // The last line of a file might not have a newline.
      var newLine = getNextLine() || "";
      return lineContents + newLine;

      function getNextLine() {
        return remainingLinesIndex < remainingLines.length ?
            remainingLines[remainingLinesIndex++] : undefined;
      }
    };

    // We need to remember the position of "remainingLines"
    var lastGeneratedLine = 1, lastGeneratedColumn = 0;

    // The generate SourceNodes we need a code range.
    // To extract it current and last mapping is used.
    // Here we store the last mapping.
    var lastMapping = null;

    aSourceMapConsumer.eachMapping(function (mapping) {
      if (lastMapping !== null) {
        // We add the code from "lastMapping" to "mapping":
        // First check if there is a new line in between.
        if (lastGeneratedLine < mapping.generatedLine) {
          // Associate first line with "lastMapping"
          addMappingWithCode(lastMapping, shiftNextLine());
          lastGeneratedLine++;
          lastGeneratedColumn = 0;
          // The remaining code is added without mapping
        } else {
          // There is no new line in between.
          // Associate the code between "lastGeneratedColumn" and
          // "mapping.generatedColumn" with "lastMapping"
          var nextLine = remainingLines[remainingLinesIndex] || '';
          var code = nextLine.substr(0, mapping.generatedColumn -
                                        lastGeneratedColumn);
          remainingLines[remainingLinesIndex] = nextLine.substr(mapping.generatedColumn -
                                              lastGeneratedColumn);
          lastGeneratedColumn = mapping.generatedColumn;
          addMappingWithCode(lastMapping, code);
          // No more remaining code, continue
          lastMapping = mapping;
          return;
        }
      }
      // We add the generated code until the first mapping
      // to the SourceNode without any mapping.
      // Each line is added as separate string.
      while (lastGeneratedLine < mapping.generatedLine) {
        node.add(shiftNextLine());
        lastGeneratedLine++;
      }
      if (lastGeneratedColumn < mapping.generatedColumn) {
        var nextLine = remainingLines[remainingLinesIndex] || '';
        node.add(nextLine.substr(0, mapping.generatedColumn));
        remainingLines[remainingLinesIndex] = nextLine.substr(mapping.generatedColumn);
        lastGeneratedColumn = mapping.generatedColumn;
      }
      lastMapping = mapping;
    }, this);
    // We have processed all mappings.
    if (remainingLinesIndex < remainingLines.length) {
      if (lastMapping) {
        // Associate the remaining code in the current line with "lastMapping"
        addMappingWithCode(lastMapping, shiftNextLine());
      }
      // and add the remaining lines without any mapping
      node.add(remainingLines.splice(remainingLinesIndex).join(""));
    }

    // Copy sourcesContent into SourceNode
    aSourceMapConsumer.sources.forEach(function (sourceFile) {
      var content = aSourceMapConsumer.sourceContentFor(sourceFile);
      if (content != null) {
        if (aRelativePath != null) {
          sourceFile = util.join(aRelativePath, sourceFile);
        }
        node.setSourceContent(sourceFile, content);
      }
    });

    return node;

    function addMappingWithCode(mapping, code) {
      if (mapping === null || mapping.source === undefined) {
        node.add(code);
      } else {
        var source = aRelativePath
          ? util.join(aRelativePath, mapping.source)
          : mapping.source;
        node.add(new SourceNode(mapping.originalLine,
                                mapping.originalColumn,
                                source,
                                code,
                                mapping.name));
      }
    }
  };

/**
 * Add a chunk of generated JS to this source node.
 *
 * @param aChunk A string snippet of generated JS code, another instance of
 *        SourceNode, or an array where each member is one of those things.
 */
SourceNode.prototype.add = function SourceNode_add(aChunk) {
  if (Array.isArray(aChunk)) {
    aChunk.forEach(function (chunk) {
      this.add(chunk);
    }, this);
  }
  else if (aChunk[isSourceNode] || typeof aChunk === "string") {
    if (aChunk) {
      this.children.push(aChunk);
    }
  }
  else {
    throw new TypeError(
      "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
    );
  }
  return this;
};

/**
 * Add a chunk of generated JS to the beginning of this source node.
 *
 * @param aChunk A string snippet of generated JS code, another instance of
 *        SourceNode, or an array where each member is one of those things.
 */
SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
  if (Array.isArray(aChunk)) {
    for (var i = aChunk.length-1; i >= 0; i--) {
      this.prepend(aChunk[i]);
    }
  }
  else if (aChunk[isSourceNode] || typeof aChunk === "string") {
    this.children.unshift(aChunk);
  }
  else {
    throw new TypeError(
      "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
    );
  }
  return this;
};

/**
 * Walk over the tree of JS snippets in this node and its children. The
 * walking function is called once for each snippet of JS and is passed that
 * snippet and the its original associated source's line/column location.
 *
 * @param aFn The traversal function.
 */
SourceNode.prototype.walk = function SourceNode_walk(aFn) {
  var chunk;
  for (var i = 0, len = this.children.length; i < len; i++) {
    chunk = this.children[i];
    if (chunk[isSourceNode]) {
      chunk.walk(aFn);
    }
    else {
      if (chunk !== '') {
        aFn(chunk, { source: this.source,
                     line: this.line,
                     column: this.column,
                     name: this.name });
      }
    }
  }
};

/**
 * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
 * each of `this.children`.
 *
 * @param aSep The separator.
 */
SourceNode.prototype.join = function SourceNode_join(aSep) {
  var newChildren;
  var i;
  var len = this.children.length;
  if (len > 0) {
    newChildren = [];
    for (i = 0; i < len-1; i++) {
      newChildren.push(this.children[i]);
      newChildren.push(aSep);
    }
    newChildren.push(this.children[i]);
    this.children = newChildren;
  }
  return this;
};

/**
 * Call String.prototype.replace on the very right-most source snippet. Useful
 * for trimming whitespace from the end of a source node, etc.
 *
 * @param aPattern The pattern to replace.
 * @param aReplacement The thing to replace the pattern with.
 */
SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
  var lastChild = this.children[this.children.length - 1];
  if (lastChild[isSourceNode]) {
    lastChild.replaceRight(aPattern, aReplacement);
  }
  else if (typeof lastChild === 'string') {
    this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
  }
  else {
    this.children.push(''.replace(aPattern, aReplacement));
  }
  return this;
};

/**
 * Set the source content for a source file. This will be added to the SourceMapGenerator
 * in the sourcesContent field.
 *
 * @param aSourceFile The filename of the source file
 * @param aSourceContent The content of the source file
 */
SourceNode.prototype.setSourceContent =
  function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
    this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
  };

/**
 * Walk over the tree of SourceNodes. The walking function is called for each
 * source file content and is passed the filename and source content.
 *
 * @param aFn The traversal function.
 */
SourceNode.prototype.walkSourceContents =
  function SourceNode_walkSourceContents(aFn) {
    for (var i = 0, len = this.children.length; i < len; i++) {
      if (this.children[i][isSourceNode]) {
        this.children[i].walkSourceContents(aFn);
      }
    }

    var sources = Object.keys(this.sourceContents);
    for (var i = 0, len = sources.length; i < len; i++) {
      aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
    }
  };

/**
 * Return the string representation of this source node. Walks over the tree
 * and concatenates all the various snippets together to one string.
 */
SourceNode.prototype.toString = function SourceNode_toString() {
  var str = "";
  this.walk(function (chunk) {
    str += chunk;
  });
  return str;
};

/**
 * Returns the string representation of this source node along with a source
 * map.
 */
SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
  var generated = {
    code: "",
    line: 1,
    column: 0
  };
  var map = new SourceMapGenerator(aArgs);
  var sourceMappingActive = false;
  var lastOriginalSource = null;
  var lastOriginalLine = null;
  var lastOriginalColumn = null;
  var lastOriginalName = null;
  this.walk(function (chunk, original) {
    generated.code += chunk;
    if (original.source !== null
        && original.line !== null
        && original.column !== null) {
      if(lastOriginalSource !== original.source
         || lastOriginalLine !== original.line
         || lastOriginalColumn !== original.column
         || lastOriginalName !== original.name) {
        map.addMapping({
          source: original.source,
          original: {
            line: original.line,
            column: original.column
          },
          generated: {
            line: generated.line,
            column: generated.column
          },
          name: original.name
        });
      }
      lastOriginalSource = original.source;
      lastOriginalLine = original.line;
      lastOriginalColumn = original.column;
      lastOriginalName = original.name;
      sourceMappingActive = true;
    } else if (sourceMappingActive) {
      map.addMapping({
        generated: {
          line: generated.line,
          column: generated.column
        }
      });
      lastOriginalSource = null;
      sourceMappingActive = false;
    }
    for (var idx = 0, length = chunk.length; idx < length; idx++) {
      if (chunk.charCodeAt(idx) === NEWLINE_CODE) {
        generated.line++;
        generated.column = 0;
        // Mappings end at eol
        if (idx + 1 === length) {
          lastOriginalSource = null;
          sourceMappingActive = false;
        } else if (sourceMappingActive) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column
            },
            generated: {
              line: generated.line,
              column: generated.column
            },
            name: original.name
          });
        }
      } else {
        generated.column++;
      }
    }
  });
  this.walkSourceContents(function (sourceFile, sourceContent) {
    map.setSourceContent(sourceFile, sourceContent);
  });

  return { code: generated.code, map: map };
};

/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
var SourceMapConsumer = sourceMapConsumer.SourceMapConsumer;

/**
 * 校正异常的堆栈信息
 *
 * 由于 rollup 会打包所有代码到一个文件，所以异常的调用栈定位和源码的位置是不同的
 * 本模块就是用来将异常的调用栈映射至源代码位置
 *
 * @see https://github.com/screepers/screeps-typescript-starter/blob/master/src/utils/ErrorMapper.ts
 */

// 缓存 SourceMap
let consumer = null;

// 第一次报错时创建 sourceMap
const getConsumer = function () {
    if (consumer == null) consumer = new SourceMapConsumer(require("main.js.map"));
    return consumer
};

// 缓存映射关系以提高性能
const cache = {};

/**
 * 使用源映射生成堆栈跟踪，并生成原始标志位
 * 警告 - global 重置之后的首次调用会产生很高的 cpu 消耗 (> 30 CPU)
 * 之后的每次调用会产生较低的 cpu 消耗 (~ 0.1 CPU / 次)
 *
 * @param {Error | string} error 错误或原始追踪栈
 * @returns {string} 映射之后的源代码追踪栈
 */
const sourceMappedStackTrace = function (error) {
    const stack = error instanceof Error ? error.stack : error;
    // 有缓存直接用
    if (cache.hasOwnProperty(stack)) return cache[stack]

    const re = /^\s+at\s+(.+?\s+)?\(?([0-z._\-\\\/]+):(\d+):(\d+)\)?$/gm;
    let match;
    let outStack = error.toString();
    console.log("ErrorMapper -> sourceMappedStackTrace -> outStack", outStack);

    while ((match = re.exec(stack))) {
        // 解析完成
        if (match[2] !== "main") break

        // 获取追踪定位
        const pos = getConsumer().originalPositionFor({
            column: parseInt(match[4], 10),
            line: parseInt(match[3], 10)
        });

        // 无法定位
        if (!pos.line) break

        // 解析追踪栈
        if (pos.name) outStack += `\n    at ${pos.name} (${pos.source}:${pos.line}:${pos.column})`;
        else {
            // 源文件没找到对应文件名，采用原始追踪名
            if (match[1]) outStack += `\n    at ${match[1]} (${pos.source}:${pos.line}:${pos.column})`;
            // 源文件没找到对应文件名并且原始追踪栈里也没有，直接省略
            else outStack += `\n    at ${pos.source}:${pos.line}:${pos.column}`;
        }
    }

    cache[stack] = outStack;
    return outStack
};

/**
 * 错误追踪包装器
 * 用于把报错信息通过 source-map 解析成源代码的错误位置
 * 和原本 wrapLoop 的区别是，wrapLoop 会返回一个新函数，而这个会直接执行
 *
 * @param next 玩家代码
 */
const errorMapper = function (next) {
    return () => {
        try {
            // 执行玩家代码
            next();
        }
        catch (e) {
            if (e instanceof Error) {
                // 渲染报错调用栈，沙盒模式用不了这个
                const errorMessage = Game.rooms.sim ?
                    `沙盒模式无法使用 source-map - 显示原始追踪栈<br>${_.escape(e.stack)}` :
                    `${_.escape(sourceMappedStackTrace(e))}`;

                console.log(`<text style="color:#ef9a9a">${errorMessage}</text>`);
            }
            // 处理不了，直接抛出
            else throw e
        }
    }
};

const spawnPercent = 0.6;
// spawn 队列等能量的兜底阈值：任务排队超过这么多 tick 还买不起 body，
// 就按当前能量换一个买得起的最小体型先孵化。
// 正常补能 100 tick 内早就够了，只在 carrier 全灭之类的饿死场景生效。
const spawnSetting = {
    affordWaitTicks: 100,
    // 总等待硬上限：能量一直在缓慢增长时也会在这么多 tick 后强制缩体型，
    // 保证兜底一定生效（正常 100 tick 内涨够就不会走到这里）
    affordMaxWaitTicks: 400,
};
const spawnTable = {
    //               0, 1, 2, 3, 4, 5, 6, 7, 8
    'harvester': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    'carrier': [0, 1, 2, 5, 5, 5, 5, 5, 5],
    'worker': [0, 3, 6, 9, 9, 7, 7, 7, 3],
    'emptyWorker': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 外矿 harvester 不按这张表自动孵化：配额由 Memory.remotePlan + 富余能量门槛决定
    'remoteHarvester': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 侦察兵同样不进正常配额：有房间需要情报时才由外矿逻辑补一个
    'viewer': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    // 外矿运输也不按这张表孵化：由 refreshRemoteSpawn 按"每房配额"补员
    'remoteCarrier': [0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const upgradeTaskCapacity = [0, 2, 2, 5, 5, 4, 4, 4, 1];
// 升级并发：有工地时仍用 upgradeTaskCapacity 的基准值，
// 工地清零后放开到实际 worker 数（不超过 maxCapacity）。
// worker 的任务顺序里 upgrade 排在 construct 前面，所以有工地时必须限流。
const upgradeSetting = {
    maxCapacity: 12,
};
// spawn/extension 顺序表的兜底扫描间隔。建成/拆除有事件，
// 这里只处理漏网的情况，频率不需要高。
const energyStructureScanInterval = 100;
// container 低/高水位（按 controller level 取）。
// 低于 low：不派新的取能任务，留一点缓冲，避免空 container 吸人。
// 达到 high：并发拉满；介于两者之间时按可用能量 / carrier 平均载重算并发。
// 数值先按经验给，后续按官服实测调整。
const containerWatermark = [
    { low: 0, high: 0 },
    { low: 50, high: 600 },
    { low: 50, high: 1000 },
    { low: 50, high: 1400 },
    { low: 50, high: 1600 },
    { low: 100, high: 1800 },
    { low: 100, high: 2000 },
    { low: 100, high: 2000 },
    { low: 100, high: 2000 }, // RCL8
];
// 单个 container 同时允许几个 creep 取能的上限（按 RCL）
const containerConcurrency = [0, 1, 2, 3, 4, 4, 5, 5, 5];
// container 列表的兜底刷新间隔。建成有 buildOver 事件，这里只处理漏网/被拆。
const containerScanInterval = 100;
// 掉落物/墓碑的机会队列：按衰减速度 + 距离评分，只保留前几条
const opportunitySetting = {
    maxTasks: 4,
    // 单条机会任务最多允许几个 creep
    maxCapacity: 2,
};
// storage 储备：低于 reserveEnergy 不再向外派取能任务
const storageSetting = {
    reserveEnergy: 5000,
    maxCapacity: 5,
};
const repairSetting = {
    // 同时存在的维修任务上限。每个任务容量 1，避免大量 worker 被维修吸走
    maxTasks: 3,
    // 单个维修任务允许几个 creep 同时修
    capacity: 1,
};
/**
 * 维修优先级：数值越小越先被 worker 领取
 * 1 关键结构 / 2 其他结构 / 3 道路
 */
const repairPriorityMap = {
    [STRUCTURE_SPAWN]: 1,
    [STRUCTURE_EXTENSION]: 1,
    [STRUCTURE_TOWER]: 1,
    [STRUCTURE_CONTAINER]: 1,
    [STRUCTURE_STORAGE]: 1,
    [STRUCTURE_LINK]: 1,
    [STRUCTURE_TERMINAL]: 1,
    [STRUCTURE_LAB]: 1,
    [STRUCTURE_ROAD]: 3,
};
function repairPriority(type) {
    var _a;
    return (_a = repairPriorityMap[type]) !== null && _a !== void 0 ? _a : 2;
}
const wallSetting = {
    // 墙体/防御墙扫描间隔，比普通维修低得多
    scanInterval: 50,
    // 同时存在的墙体维修任务上限
    maxTasks: 2,
    // 单个墙体维修任务允许几个 creep
    capacity: 1,
    // 每次扫描最多放进队列的目标数
    queueSize: 10,
    // 目标血量按 controller level 取，0 表示不维护
    targetHits: [0, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 300000],
    // storage 能量达到该值以上才开始维护，避免前期把能量全填进墙里
    minStorageEnergy: 50000,
};
const harvestSetting = {
    // 每个矿点允许的采集者数量：平时 1 个，换班时新旧 harvester 可以同时占用
    capacity: 2,
    // 提前量：spawn 排队、地形绕路等额外预留的 tick
    earlyMargin: 15,
    // 没有布局距离缓存时的默认路径长度（tile）
    defaultDistance: 20,
};
// 外矿（"富余能量才做"的添头）
const remoteSetting = {
    // 同一个外矿 container 同时允许几个 carrier 去拉
    carryCapacity: 2,
    // harvester 修外矿 container 的血量阈值：低于 hitsMax * 该值就优先维修
    repairThreshold: 0.9,
    // 每个主房自动选定的外矿房上限（相邻房最多四个）
    maxRooms: 4,
    // 每个"已建好 container"的外矿房配几个专用 remoteCarrier
    carriersPerRoom: 1,
};
const towerSetting = {
    // 和平时期每 5 tick 扫描一次敌对 creep，防御时期每 tick 扫描
    threatScanInterval: 5,
    // 每 15 tick 刷新一次维修队列
    repairScanInterval: 15,
    // 连续 N 次扫描没有敌对 creep 才切回和平
    calmTicksToPeace: 2,
    // 塔能量低于 60% 时请求 carrier 补能
    refillThreshold: 0.6,
    // 补能请求的节流间隔
    refillInterval: 10,
    // 维修时保留 50% 能量用于防守/治疗
    repairReserve: 0.5,
    // hits 低于最大值的 80% 才进入维修队列
    repairThreshold: 0.8,
};

// 此文件定义的所有Task执行的func都是绑定在Creep的prototype上的
/**
 * 采集资源Task的包装类, 将room中所有资源转换为采集Task并返回
 * @param room
 */
function harvestSource(room) {
    const sources = room.sources();
    // TODO: 这里的containerPos是直接返回的数组，需要找到最近的container，大概是一个不超过4的for循环，但是也可以再优化
    const containerPos = room.containerPos().map(item => {
        return room.getPositionAt(item[0], item[1]);
    });
    // console.log(containerPos)
    let tasks = [];
    for (const sourceId of sources) {
        const source = Game.getObjectById(sourceId);
        if (!source) {
            continue;
        }
        const pos = source.pos.findInRange(containerPos, 1);
        const targetPos = pos[0];
        tasks.push({
            taskType: 'harvestTask',
            taskFunc: 'harvestSource',
            // 找不到 source 旁的 container / 工地时退化为直接走到 source 旁边采集
            taskParam: targetPos ? [sourceId, targetPos.x, targetPos.y] : [sourceId, null, null],
            // 平时每个矿点 1 个采集者；容量 2 是为了换班时新旧 harvester 能同时上岗
            capacity: harvestSetting.capacity,
        });
    }
    return tasks;
}
/**
 * 升级任务并发：
 * - 有工地时用 RCL 基准值，保证建造有人干（worker 会先抢 upgrade 再抢 construct）
 * - 工地清零后放开到实际 worker 数，把闲置劳动力转成进度
 */
function upgradeTaskCapacityOf(room) {
    var _a;
    const level = room.controller ? room.controller.level : 0;
    const base = (_a = upgradeTaskCapacity[level]) !== null && _a !== void 0 ? _a : 0;
    if (!base) {
        return 0;
    }
    if (room.find(FIND_CONSTRUCTION_SITES).length > 0) {
        // 有工地时压低升级并发（最多 2 个）：把有能量的 worker 让给建造，
        // 尤其是 priority 1 的 extension 工地；工地清零后再按 worker 数放开。
        return Math.max(1, Math.min(base, 2));
    }
    // emptyWorker 只是临时取能状态，按 oldRole 折算回原职业
    const workerCount = room.find(FIND_MY_CREEPS, {
        filter: creep => {
            const role = creep.memory.role === 'emptyWorker'
                ? creep.memory.oldRole
                : creep.memory.role;
            return role === 'worker';
        }
    }).length;
    return Math.max(base, Math.min(upgradeSetting.maxCapacity, workerCount));
}
function upgrade(room) {
    const capacity = upgradeTaskCapacityOf(room);
    if (!capacity) {
        return [];
    }
    return [{
            taskType: 'upgradeTask',
            taskFunc: 'upgrade',
            taskParam: [room.controller.id],
            capacity: capacity,
            persistent: true,
            targetId: room.controller.id
        }];
}
function construct(ConstructionSiteId) {
    return [{
            taskType: 'constructTask',
            taskFunc: 'construct',
            taskParam: [ConstructionSiteId]
        }];
}
function getContainerEnergy(room) {
    var _a, _b;
    const containerIds = room.getContainer();
    if (!containerIds || !containerIds.length) {
        return [];
    }
    const level = room.controller ? room.controller.level : 0;
    const watermark = (_a = containerWatermark[level]) !== null && _a !== void 0 ? _a : containerWatermark[0];
    const maxConcurrency = (_b = containerConcurrency[level]) !== null && _b !== void 0 ? _b : 0;
    if (!maxConcurrency) {
        return [];
    }
    const avgCarry = room.avgCarrierCapacity();
    const tasks = [];
    for (const containerId of containerIds) {
        const container = Game.getObjectById(containerId);
        if (!container) {
            continue;
        }
        const energy = container.store.getUsedCapacity(RESOURCE_ENERGY);
        const usable = energy - watermark.low;
        // 低于低水位不建任务，留一点缓冲，避免空 container 吸人
        if (usable <= 0) {
            continue;
        }
        // 高水位以上并发拉满；介于低/高水位之间按可用能量/平均载重算，
        // 大 carrier 一次能取多，需要的并发自然下降。
        const capacity = energy >= watermark.high
            ? maxConcurrency
            : Math.max(1, Math.min(maxConcurrency, Math.ceil(usable / avgCarry)));
        tasks.push({
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            priority: 2,
            taskParam: [containerId, RESOURCE_ENERGY],
            capacity: capacity
        });
    }
    return tasks;
}
/**
 * 掉落物/墓碑的机会队列：都会衰减，不能按固定任务容量管理。
 * 评分越高越优先：量越大、剩余寿命越短、离 spawn 越近。
 * 只保留前 opportunitySetting.maxTasks 条。
 */
function getOpportunityEnergy(room) {
    var _a, _b;
    const avgCarry = room.avgCarrierCapacity();
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    const candidates = [];
    const scoreOf = (amount, ticksToDecay, distance) => amount / ((ticksToDecay + 1) * (10 + distance));
    // 掉落物：直接用 find 拿本 tick 的新鲜对象。
    // global.room 里缓存的 Resource 跨 tick 会失效（id 都读不到），不能用。
    for (const resource of room.find(FIND_DROPPED_RESOURCES)) {
        if (resource.resourceType !== RESOURCE_ENERGY || !resource.amount) {
            continue;
        }
        const distance = spawn ? resource.pos.getRangeTo(spawn) : 10;
        // @types/screeps 的 Resource 没声明 ticksToDecay，运行时是有的
        const ticksToDecay = (_a = resource.ticksToDecay) !== null && _a !== void 0 ? _a : 1000;
        candidates.push({
            id: resource.id,
            taskFunc: 'collectEnergy',
            amount: resource.amount,
            score: scoreOf(resource.amount, ticksToDecay, distance)
        });
    }
    // 墓碑：几十 tick 就消失，优先于远处的大堆掉落物
    for (const tombstone of room.find(FIND_TOMBSTONES)) {
        const amount = tombstone.store.getUsedCapacity(RESOURCE_ENERGY);
        if (!amount) {
            continue;
        }
        const distance = spawn ? tombstone.pos.getRangeTo(spawn) : 10;
        candidates.push({
            id: tombstone.id,
            taskFunc: 'getEnergyFromStructure',
            amount: amount,
            score: scoreOf(amount, (_b = tombstone.ticksToDecay) !== null && _b !== void 0 ? _b : 100, distance)
        });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, opportunitySetting.maxTasks).map(candidate => ({
        taskType: 'energyTask',
        taskFunc: candidate.taskFunc,
        priority: 1,
        taskParam: [candidate.id, RESOURCE_ENERGY],
        capacity: candidate.amount >= avgCarry ? opportunitySetting.maxCapacity : 1
    }));
}
function getStorageEnergy(room) {
    const storage = room.storage;
    if (!storage) {
        return [];
    }
    const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);
    // storage 是储备，低于保留量不再向外派任务
    const usable = energy - storageSetting.reserveEnergy;
    if (usable <= 0) {
        return [];
    }
    const avgCarry = room.avgCarrierCapacity();
    const capacity = Math.max(1, Math.min(storageSetting.maxCapacity, Math.ceil(usable / avgCarry)));
    return [{
            taskType: 'energyTask',
            taskFunc: 'getEnergyFromStructure',
            priority: 3,
            taskParam: [storage.id, RESOURCE_ENERGY],
            capacity: capacity
        }];
}
function getEnergyTask(room) {
    const containTasks = getContainerEnergy(room);
    const opportunityTasks = getOpportunityEnergy(room);
    const storageTasks = getStorageEnergy(room);
    return [...containTasks, ...opportunityTasks, ...storageTasks];
}
// export function getEnergyWithStorage(room: Room): MyTask[] {
//     let tasks = getContainerEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     tasks = getResourceEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     tasks = getStorageEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     return []
// }
// export function getEnergyWithoutStorage(room:Room): MyTask[] {
//     let tasks = getContainerEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
//     tasks = getResourceEnergy(room)
//     if (tasks.length) {
//         return tasks
//     }
// }
function getCarryList(targetList, resourceType) {
    return targetList.map(item => {
        return {
            taskType: 'carryTask',
            taskFunc: "carryEnergy",
            taskParam: [item.id, resourceType],
            priority: 1,
            capacity: 1,
            persistent: true,
            targetId: item.id
        };
    });
}
/**
 * 外矿采集任务：一个矿点一条，容量 1（常驻 harvester 一人一矿）。
 * taskParam: [sourceId, 外矿房名, 主房名]
 * sourceId 为 null 的探路任务由房间扩展自己构造。
 */
function getRemoteHarvestTasks(sourceIds, targetRoom, homeRoom) {
    return sourceIds.map(sourceId => ({
        taskType: 'remoteHarvestTask',
        taskFunc: 'remoteHarvest',
        taskParam: [sourceId, targetRoom, homeRoom],
        priority: 3,
        capacity: 1,
        targetId: sourceId,
    }));
}
/**
 * 外矿运输任务：去外矿 container 取能，回到主房投递后才结束。
 * taskParam: [外矿 containerId, 外矿房名, 主房名, 主房投递目标]
 */
function getRemoteCarryTasks(containerId, targetRoom, homeRoom, sinkId) {
    return [{
            taskType: 'remoteCarryTask',
            taskFunc: 'remoteCarry',
            taskParam: [containerId, targetRoom, homeRoom, sinkId],
            priority: 3,
            capacity: remoteSetting.carryCapacity,
            targetId: containerId,
        }];
}
/**
 * 把扫描出的受损建筑转换成 worker 的维修任务。
 * 容量固定为 1，避免同一个建筑上堆太多 worker。
 */
function getRepairTasks(targetList) {
    return targetList.map(item => ({
        taskType: 'repairTask',
        taskFunc: 'repairStructure',
        priority: repairPriority(item.structureType),
        capacity: repairSetting.capacity,
        persistent: true,
        targetId: item.id,
        taskParam: [item.id],
    }));
}
/**
 * 墙体/防御墙维护任务。和普通维修共用 repairStructure，
 * 但单独放在 wallRepairTask 桶里，数量受 wallSetting.maxTasks 限制。
 */
function getWallRepairTasks(targetList, targetHits) {
    return targetList.map(item => ({
        taskType: 'wallRepairTask',
        taskFunc: 'repairStructure',
        priority: item.structureType == STRUCTURE_RAMPART ? 1 : 2,
        capacity: wallSetting.capacity,
        persistent: true,
        targetId: item.id,
        // 第二个参数是维护目标血量：墙/rampart 的 hitsMax 是 3 亿，不能修到满
        taskParam: [item.id, targetHits],
    }));
}
function createBuildTask(targetList) {
    return targetList.map(item => {
        let constructionType = item.structureType;
        let priority = 3;
        // 注意：这里必须用 includes，in 判断的是数组下标而不是元素
        // 前期优先建 spawn/extension（直接决定能孵化多少 creep），container 其次
        const priority1Structures = [STRUCTURE_EXTENSION, STRUCTURE_SPAWN];
        const priority2Structures = [STRUCTURE_TOWER];
        const priority4Structures = [STRUCTURE_ROAD, STRUCTURE_RAMPART, STRUCTURE_WALL];
        if (priority1Structures.includes(constructionType)) {
            priority = 1;
        }
        else if (priority2Structures.includes(constructionType)) {
            priority = 2;
        }
        else if (priority4Structures.includes(constructionType)) {
            priority = 4;
        }
        return {
            taskType: 'constructTask',
            taskFunc: "buildConstructionSite",
            taskParam: [item.id],
            priority: priority,
            capacity: 5
        };
    });
}

class logger {
    constructor() {
        this.levels = {
            "DEBUG": 1,
            "INFO": 2,
            "WARNING": 3,
            "ERROR": 4,
            "CONSOLE": 5
        };
        this.currentLevel = this.levels["DEBUG"]; // 设置默认日志级别为 DEBUG
    }
    setLevel(level) {
        if (level in this.levels) {
            this.currentLevel = this.levels[level];
        }
        else {
            console.error(`Invalid log level: ${level}`);
        }
    }
    log(level, content, prefixes = [], color = null, notify = false) {
        if (level >= this.currentLevel) {
            // 有前缀就组装在一起
            let prefix = prefixes.length > 0 ? `${prefixes.join(' ')}` : '';
            // 指定了颜色
            prefix = colorful(prefix, color, true);
            content = colorful(content, color);
            const logContent = `${prefix}${content}`;
            console.log(logContent);
            // 转发到邮箱
            if (notify)
                Game.notify(logContent);
        }
    }
    debug(message) {
        this.log(this.levels['DEBUG'], message, ["DEBUG "], 'white');
    }
    info(message) {
        this.log(this.levels['INFO'], message, ["+ "], 'blue');
    }
    warning(message) {
        this.log(this.levels['WARNING'], message, [""], 'yellow');
    }
    error(message) {
        this.log(this.levels['ERROR'], message, ["- "], "red");
    }
    console(message) {
        this.log(this.levels['CONSOLE'], message, [""], "white");
    }
}
function colorful(content, colorName = null, bolder = false) {
    const colorStyle = colorName ? `color: ${colors[colorName]};` : '';
    const bolderStyle = bolder ? 'font-weight: bolder;' : '';
    return `<text style="${[colorStyle, bolderStyle].join(' ')}">${content}</text>`;
}
const colors = {
    red: '#ef9a9a',
    green: '#6b9955',
    yellow: '#c5c599',
    blue: '#8dc5e3',
    white: '#f7f9f7'
};
const loggerInstance = new logger();

/**
 * 外矿房自动规划：
 * - 相邻房用 Game.map.describeExits 拿，不需要视野、开销很小
 * - 已知 unsafe（有主/被他人 reserve/有敌对）的房直接排除
 * - 已知有矿的优先，未知的其次（交给侦察兵去探）
 * - 每个主房最多 remoteSetting.maxRooms 个
 */
function planRemoteRooms(homeRoomName) {
    var _a, _b, _c, _d, _e;
    const exits = Game.map.describeExits(homeRoomName);
    if (!exits) {
        return [];
    }
    const intelMap = (_a = Memory.mapIntel) !== null && _a !== void 0 ? _a : {};
    const seen = {};
    const candidates = [];
    for (const dir in exits) {
        const name = exits[dir];
        if (!name || seen[name]) {
            continue;
        }
        seen[name] = true;
        if (((_b = Game.map.getRoomStatus(name)) === null || _b === void 0 ? void 0 : _b.status) === 'closed') {
            continue;
        }
        const intel = intelMap[name];
        if (intel === null || intel === void 0 ? void 0 : intel.unsafe) {
            continue;
        }
        const room = Game.rooms[name];
        if ((_c = room === null || room === void 0 ? void 0 : room.controller) === null || _c === void 0 ? void 0 : _c.my) {
            continue;
        }
        const sourceCount = (_e = (_d = intel === null || intel === void 0 ? void 0 : intel.sources) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : -1;
        if (sourceCount === 0) {
            // 探明过但没有矿，不值得占外矿名额
            continue;
        }
        candidates.push({
            name,
            // 已知 2 矿 > 已知 1 矿 > 未知
            score: sourceCount >= 2 ? 3 : sourceCount === 1 ? 2 : 1,
        });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.map(item => item.name).slice(0, remoteSetting.maxRooms);
}
/**
 * 把一次视野里看到的外矿房信息写进 Memory.mapIntel，并同步 plan 状态。
 * 有主 / 被别人 reserve / 有敌对 → 停用该外矿房；
 * 已经是我们自己的房 → 从 plan 移除；安全 → 填 sources，交给采集流程。
 */
function recordRoomIntel(homeRoomName, room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!Memory.mapIntel) {
        Memory.mapIntel = {};
    }
    const intel = (_a = Memory.mapIntel[room.name]) !== null && _a !== void 0 ? _a : (Memory.mapIntel[room.name] = {});
    const me = (_d = (_c = (_b = Game.rooms[homeRoomName]) === null || _b === void 0 ? void 0 : _b.controller) === null || _c === void 0 ? void 0 : _c.owner) === null || _d === void 0 ? void 0 : _d.username;
    const controller = room.controller;
    const sources = room.find(FIND_SOURCES);
    intel.scoutedAt = Game.time;
    intel.sources = sources.map(source => source.id);
    intel.owner = (_e = controller === null || controller === void 0 ? void 0 : controller.owner) === null || _e === void 0 ? void 0 : _e.username;
    intel.reservation = (_f = controller === null || controller === void 0 ? void 0 : controller.reservation) === null || _f === void 0 ? void 0 : _f.username;
    intel.hostile = room.find(FIND_HOSTILE_CREEPS).length > 0;
    intel.unsafe = !!intel.hostile
        || !!((controller === null || controller === void 0 ? void 0 : controller.owner) && !controller.my)
        || !!((controller === null || controller === void 0 ? void 0 : controller.reservation) && controller.reservation.username !== me);
    const plan = (_g = Memory.remotePlan) === null || _g === void 0 ? void 0 : _g[homeRoomName];
    const state = (_h = plan === null || plan === void 0 ? void 0 : plan.rooms) === null || _h === void 0 ? void 0 : _h[room.name];
    if (!plan || !plan.rooms || !state) {
        return;
    }
    if (controller === null || controller === void 0 ? void 0 : controller.my) {
        // 已经是我们自己的房间，不再算外矿
        delete plan.rooms[room.name];
        return;
    }
    if (intel.unsafe) {
        state.enabled = false;
        return;
    }
    state.enabled = true;
    const sourceStates = (_j = state.sources) !== null && _j !== void 0 ? _j : (state.sources = {});
    for (const source of sources) {
        if (!sourceStates[source.id]) {
            sourceStates[source.id] = {};
        }
    }
}

// import {getCarryList, getEnergyWithStorage} from "@/task/roomTask";
const roleToTask = {
    'harvester': ['harvestTask'],
    // 维修排在升级前，但维修任务总量受 repairSetting.maxTasks 限制，
    // 只有少数 worker 会短暂转去维修，修完后自动回来升级
    'worker': ['repairTask', 'wallRepairTask', 'upgradeTask', 'constructTask'],
    'emptyWorker': ['energyTask'],
    // 本地补能永远先认领，空闲时才去外矿拉货
    'carrier': ['carryTask', 'remoteCarryTask'],
    'remoteHarvester': ['remoteHarvestTask'],
    // 外矿专用运输只做外矿往返，保证外矿 container 不会因为本地任务不断出现而被饿死
    'remoteCarrier': ['remoteCarryTask'],
    // 侦察兵只有一个常驻任务，自己从外矿计划里挑要探的房间
    'viewer': ['scoutTask'],
};
class CreepExtension extends Creep {
    /**
     * 在编写work函数的时候需要注意working标志和res返回的结果
     * res返回的结果表示此回合还需不需要继续
     * working的结果表示工作做完了没有
     * 因为creep的res的OK表示纳入计划, 最后在回合结束时统一结算, 所以会出现,工作做完了,但是这个回合不需要继续的情况
     */
    work() {
        // console.log(this.name)
        if (this.spawning) {
            // console.log(this.ticksToLive)
            return;
        }
        let loop = 0;
        while (loop < 4) {
            if (!this.memory.role) {
                loggerInstance.error(this.name + " ERROR!");
                this.remember();
                return;
            }
            if (!this.memory.working) {
                if (!this.getWork()) {
                    // 外矿 carrier 的空闲处理自己会发移动意图（回家/原地待命），
                    // 这里再随机走会覆盖 moveToRoom，导致永远回不了主房
                    if (this.memory.role !== 'remoteCarrier') {
                        this.say('🤓 没活辣,随便走走');
                        const directions = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
                        const randIndex = Math.floor(Math.random() * directions.length);
                        this.move(directions[randIndex]);
                    }
                    return;
                }
            }
            const res = this[this.memory.currentWork.taskFunc](...this.memory.currentWork.taskParam);
            if (!res) {
                // false return , true not
                return;
            }
            this.releaseCurrentWork();
            loop += 1;
        }
        return;
    }
    getWork() {
        var _a;
        const room = this.room;
        if (!room.memory.creepTask) {
            // 外矿房/走廊房没有任务桶：remoteCarrier 不能原地发呆，
            // 先回家再把身上能量交接掉（被别的 carrier 踢出任务时会走到这里）
            if (this.memory.role === 'remoteCarrier') {
                return this.remoteCarrierIdle();
            }
            return false;
        }
        // console.log(this.memory.role)
        if (this.memory.role === 'emptyWorker' && room.memory.lastEnergyTaskTick !== Game.time) {
            const energyBuckets = room.normalizeTaskBuckets('energyTask');
            let hasEnergyTask = false;
            for (const key in energyBuckets) {
                if ((_a = energyBuckets[key]) === null || _a === void 0 ? void 0 : _a.length) {
                    hasEnergyTask = true;
                    break;
                }
            }
            if (!hasEnergyTask) {
                room.registTask(getEnergyTask(room));
            }
            room.memory.lastEnergyTaskTick = Game.time;
        }
        const TaskList = roleToTask[this.memory.role];
        const now = Game.time;
        // 提前换班孵化出来的 harvester 只认领孵化时指定的矿点
        const assignedSource = this.memory.role === 'harvester' ? this.memory.harvestSourceId : undefined;
        for (const taskType of TaskList) {
            const buckets = room.normalizeTaskBuckets(taskType);
            if (!buckets) {
                continue;
            }
            const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
            for (const key of keys) {
                let queue = buckets[String(key)];
                if (!queue || !queue.length) {
                    continue;
                }
                if (taskType === 'harvestTask') {
                    if (assignedSource) {
                        // 指定的矿点优先；如果该矿点已满，再退回到其他矿点，避免替补原地发呆
                        queue = [...queue].sort((a, b) => {
                            var _a, _b;
                            const aMatched = ((_a = a === null || a === void 0 ? void 0 : a.taskParam) === null || _a === void 0 ? void 0 : _a[0]) === assignedSource ? 0 : 1;
                            const bMatched = ((_b = b === null || b === void 0 ? void 0 : b.taskParam) === null || _b === void 0 ? void 0 : _b[0]) === assignedSource ? 0 : 1;
                            return aMatched - bMatched;
                        });
                    }
                    else {
                        // 没指定矿点时优先选还没人预约的矿点，避免多个 harvester 挤在一个矿上
                        queue = [...queue].sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = a === null || a === void 0 ? void 0 : a.reservedBy) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) - ((_d = (_c = b === null || b === void 0 ? void 0 : b.reservedBy) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0); });
                    }
                }
                else if (taskType === 'energyTask') {
                    // 多个 container / 掉落物时优先去没人预约的，避免所有缺能量的 creep 挤在一个矿点
                    queue = [...queue].sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = a === null || a === void 0 ? void 0 : a.reservedBy) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) - ((_d = (_c = b === null || b === void 0 ? void 0 : b.reservedBy) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0); });
                }
                for (let i = 0; i < queue.length; i++) {
                    const task = queue[i];
                    if (!task) {
                        continue;
                    }
                    if (task.capacity === undefined) {
                        task.capacity = 1;
                    }
                    if (!task.reservedBy) {
                        task.reservedBy = [];
                    }
                    // 清理已经死掉的 creep 留下的预约，否则 persistent 任务会被永久占满
                    task.reservedBy = task.reservedBy.filter(item => item && Game.creeps[item.name]);
                    const existing = task.reservedBy.find(item => item.name === this.name);
                    if (existing) {
                        existing.lastTick = now;
                    }
                    else {
                        if (task.reservedBy.length >= task.capacity) {
                            continue;
                        }
                        task.reservedBy.push({ name: this.name, lastTick: now });
                    }
                    this.memory.currentWork = task;
                    this.memory.currentWorkType = taskType;
                    this.memory.working = true;
                    return true;
                }
            }
        }
        // 身上有能量却找不到任务：emptyWorker 直接回原职业，避免带着能量发呆。
        // 正常回退发生在 getEnergyFromStructure / collectEnergy 成功分支里，
        // 但任务被清掉、只捡到部分能量时会漏掉，这里兜底。
        if (this.memory.role === 'emptyWorker'
            && this.memory.oldRole
            && this.memory.oldRole !== 'emptyWorker'
            && this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            const targetRole = this.memory.oldRole;
            this.changeRole(targetRole);
            delete this.memory.oldRole;
            return this.getWork();
        }
        // 外矿 carrier 没任务时不能转 emptyWorker（会和本地取能抢任务），
        // 但必须保证不滞留在外矿房：先回主房，身上有能量就交给主房接收点。
        if (this.memory.role === 'remoteCarrier') {
            return this.remoteCarrierIdle();
        }
        // 没任务可做且身上没能量：转成 emptyWorker 去取能，避免原地空转。
        // 取满后由 getEnergyFromStructure 按 oldRole 回到原职业。
        // harvester / remoteHarvester 不参与（采集不耗能量），emptyWorker 本身不用再转。
        if (this.memory.role !== 'emptyWorker'
            && this.memory.role !== 'harvester'
            && this.memory.role !== 'remoteHarvester'
            && this.memory.role !== 'viewer'
            && this.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
            this.changeRole('emptyWorker');
        }
        return false;
    }
    changeRole(role) {
        if (!role) {
            return false;
        }
        this.releaseCurrentWork();
        this.memory.oldRole = this.memory.role;
        this.memory.role = role;
        return true;
    }
    releaseCurrentWork() {
        var _a, _b;
        const task = this.memory.currentWork;
        const taskType = this.memory.currentWorkType;
        if (task && task.reservedBy) {
            task.reservedBy = task.reservedBy.filter(item => item.name !== this.name);
        }
        if (task && taskType) {
            const buckets = this.room.normalizeTaskBuckets(taskType);
            const taskId = task.id;
            const taskTargetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
            for (const key in buckets) {
                const queue = buckets[key];
                if (!queue || !queue.length) {
                    continue;
                }
                for (const item of queue) {
                    if (!item || !item.reservedBy) {
                        continue;
                    }
                    if (item.id === taskId || (taskTargetId && item.targetId === taskTargetId)) {
                        item.reservedBy = item.reservedBy.filter(entry => entry.name !== this.name);
                    }
                }
            }
        }
        this.memory.working = false;
        this.memory.currentWork = undefined;
        this.memory.currentWorkType = undefined;
    }
    removeCurrentWorkFromQueue() {
        var _a, _b, _c;
        const task = this.memory.currentWork;
        const taskType = this.memory.currentWorkType;
        if (!taskType || !task) {
            return;
        }
        const buckets = this.room.normalizeTaskBuckets(taskType);
        if (!buckets) {
            return;
        }
        const taskId = task.id;
        const taskTargetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
        for (const key in buckets) {
            const queue = buckets[key];
            if (!queue || !queue.length) {
                continue;
            }
            for (let i = 0; i < queue.length; i++) {
                const item = queue[i];
                if (!item) {
                    continue;
                }
                if (item.id === taskId || (taskTargetId && item.targetId === taskTargetId)) {
                    if (item.reservedBy && item.reservedBy.length) {
                        for (const reserver of item.reservedBy) {
                            if (!reserver || reserver.name === this.name) {
                                continue;
                            }
                            (_c = Game.creeps[reserver.name]) === null || _c === void 0 ? void 0 : _c.releaseCurrentWork();
                        }
                    }
                    queue.splice(i, 1);
                    if (!queue.length) {
                        delete buckets[key];
                    }
                    return;
                }
            }
        }
    }
    harvestSource(sourceId, containerPosX, ContainerPosY) {
        const source = Game.getObjectById(sourceId);
        if (!source) {
            return true;
        }
        this.say("⛏️007采矿");
        // 引擎的 harvest 溢出会先填进同一格的 container（_create-energy），
        // 所以站在 container 上持续 harvest 即可；transfer 会白占一个采集 tick。
        const standingOnContainer = this.pos.lookFor(LOOK_STRUCTURES)
            .some(item => item.structureType === STRUCTURE_CONTAINER);
        if (standingOnContainer && this.pos.inRangeTo(source, 1)) {
            this.harvest(source);
            return false;
        }
        // taskParam 里的坐标可能是 container 建成前缓存的旧位置，优先找矿点旁真实的 container
        const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (object) => object.structureType === STRUCTURE_CONTAINER
        })[0];
        if (container) {
            this.moveTo(container.pos, { visualizePathStyle: { stroke: '#ffffff' } });
            return false;
        }
        // 没有 container / 工地位置时退化为直接贴着 source 采集
        if (containerPosX === undefined || ContainerPosY === undefined) {
            if (!this.pos.inRangeTo(source, 1)) {
                this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } });
            }
            else {
                this.harvest(source);
            }
            return false;
        }
        if (!this.pos.inRangeTo(containerPosX, ContainerPosY, 0)) {
            this.moveTo(containerPosX, ContainerPosY, { visualizePathStyle: { stroke: '#ffffff' } });
        }
        else {
            this.harvest(source);
        }
        return false;
    }
    getEnergyFromStructure(id, energyType) {
        var _a, _b, _c;
        const structure = Game.getObjectById(id);
        if (!structure) {
            this.removeCurrentWorkFromQueue();
            this.releaseCurrentWork();
            const targetRole = (_a = this.memory.oldRole) !== null && _a !== void 0 ? _a : this.memory.role;
            if (targetRole) {
                this.changeRole(targetRole);
            }
            else {
                this.remember();
            }
            delete this.memory.oldRole;
            return true;
        }
        this.say("🫳偷拿资源");
        if (!this.store.getFreeCapacity()) {
            const targetRole = (_b = this.memory.oldRole) !== null && _b !== void 0 ? _b : this.memory.role;
            if (targetRole) {
                this.changeRole(targetRole);
            }
            else {
                this.remember();
            }
            delete this.memory.oldRole;
            return true;
        }
        const res = this.withdraw(structure, energyType);
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(structure, { visualizePathStyle: { stroke: '#ffff00' } });
            return false;
        }
        else if (res == OK) {
            const targetRole = this.memory.oldRole;
            if (targetRole) {
                this.changeRole(targetRole);
            }
            else {
                this.remember();
            }
            delete this.memory.oldRole;
            return true;
        }
        else if (res == ERR_NOT_ENOUGH_RESOURCES) {
            // 目标已经空了：把任务移出队列，否则所有 emptyWorker 会一直围着它转
            this.removeCurrentWorkFromQueue();
            return true;
        }
        else if (res == ERR_FULL) {
            const targetRole = (_c = this.memory.oldRole) !== null && _c !== void 0 ? _c : this.memory.role;
            if (targetRole) {
                this.changeRole(targetRole);
            }
            else {
                this.remember();
            }
            delete this.memory.oldRole;
            return true;
        }
        return false;
    }
    collectEnergy(id) {
        const resource = Game.getObjectById(id);
        if (!resource) {
            this.removeCurrentWorkFromQueue();
            return true;
        }
        this.say("🫳捡资源去");
        const res = this.pickup(resource);
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(resource, { visualizePathStyle: { stroke: '#ffff00' } });
            return false;
        }
        else if (res == OK) {
            if (!this.store.getFreeCapacity()) {
                // console.log(this.store.getFreeCapacity())
                const targetRole = this.memory.oldRole;
                if (targetRole) {
                    this.changeRole(targetRole);
                }
                else {
                    this.remember();
                }
                delete this.memory.oldRole;
            }
            return true;
        }
        else if (res == ERR_FULL) {
            // console.log(this.store.getFreeCapacity())
            const targetRole = this.memory.oldRole;
            if (targetRole) {
                this.changeRole(targetRole);
            }
            else {
                this.remember();
            }
            delete this.memory.oldRole;
            return true;
        }
        return false;
    }
    upgrade(controllerId) {
        const controller = Game.getObjectById(controllerId);
        if (!controller) {
            return true;
        }
        if (this.store['energy']) {
            this.say("⚡升本!");
            if (this.upgradeController(controller) == ERR_NOT_IN_RANGE) {
                this.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
                return false;
            }
        }
        else {
            this.changeRole('emptyWorker');
            return true;
        }
        return false;
    }
    remember() {
        let a = this.name.lastIndexOf("r");
        this.memory.role = this.name.slice(0, a + 1);
        this.memory.working = false;
        this.memory.spawnRoom = this.room.name;
        this.memory.reSpawn = false;
        // console.log(name)
    }
    carryEnergy(targetId, resourceType) {
        if (this.store['energy']) {
            const target = Game.getObjectById(targetId);
            if (!target) {
                this.say("⚡找不到目标");
                this.removeCurrentWorkFromQueue();
                // const targetRole = this.memory.oldRole ?? this.memory.role
                // if (targetRole) {
                //     this.changeRole(targetRole)
                // } else {
                //     this.remember()
                // }
                // delete this.memory.oldRole
                return true;
            }
            if (!target.store.getFreeCapacity(resourceType)) {
                this.say("⚡目标已满");
                this.removeCurrentWorkFromQueue();
                // this.releaseCurrentWork()
                // const targetRole = this.memory.oldRole ?? this.memory.role
                // if (targetRole) {
                //     this.changeRole(targetRole)
                // } else {
                //     this.remember()
                // }
                // delete this.memory.oldRole
                return true;
            }
            // 目标没满
            this.say("⚡运输中");
            const res = this.transfer(target, resourceType);
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
                return false;
            }
            else if (res == OK) {
                // 这个persistent不知道是用来干什么的，先不删了
                // if (this.memory.currentWork?.persistent && !target.store.getFreeCapacity(resourceType)) {
                if (!target.store.getFreeCapacity(resourceType)) {
                    this.removeCurrentWorkFromQueue();
                    return true;
                }
                return false;
            }
            else if (res == ERR_FULL) {
                this.say("⚡目标已满");
                this.removeCurrentWorkFromQueue();
                return true;
            }
        }
        else {
            // 高优先级补能任务自带取能：carrier 直接去能量最多的 container 取，
            // 不再降级成 emptyWorker 去和普通 worker 抢 energyTask——
            // 那样会丢掉 carryTask 的 priority 1，spawn/extension 的补能会被拖慢。
            const source = this.room.bestEnergyContainer();
            if (source) {
                this.say("⚡补能取能");
                const res = this.withdraw(source, resourceType);
                if (res == ERR_NOT_IN_RANGE) {
                    this.moveTo(source, { visualizePathStyle: { stroke: '#ffff00' } });
                    return false;
                }
                if (res == OK) {
                    // 取到了，下一 tick 继续这个 carryTask 去投递
                    return false;
                }
            }
            // 没有可取的 container（或刚好被别人取空）：退回通用取能
            this.changeRole('emptyWorker');
            return true;
        }
        return false;
    }
    repairStructure(targetId, targetHits) {
        var _a;
        const target = Game.getObjectById(targetId);
        const goalHits = (_a = targetHits !== null && targetHits !== void 0 ? targetHits : target === null || target === void 0 ? void 0 : target.hitsMax) !== null && _a !== void 0 ? _a : 0;
        if (!target || target.hits >= goalHits) {
            // 目标已经修好/消失，把任务移出队列
            this.removeCurrentWorkFromQueue();
            this.releaseCurrentWork();
            return true;
        }
        if (!this.store['energy']) {
            this.changeRole('emptyWorker');
            return true;
        }
        this.say("🔧维修中");
        const res = this.repair(target);
        if (res == ERR_NOT_IN_RANGE) {
            this.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
            return false;
        }
        if (res == OK) {
            // 继续修，下一 tick 检查是否已经满了
            return false;
        }
        // ERR_NOT_OWNER / ERR_INVALID_TARGET / ERR_RCL_NOT_ENOUGH 等，任务作废
        this.removeCurrentWorkFromQueue();
        this.releaseCurrentWork();
        return true;
    }
    buildConstructionSite(constructionId) {
        if (this.store['energy']) {
            this.say("⚡建造中");
            const target = Game.getObjectById(constructionId);
            if (!target) {
                // 工地已经完成/被拆：必须把这条任务从队列里删掉，否则它会一直留在
                // 队首，每个 worker 每 tick 反复领到同一个死任务，永远轮不到后面的任务
                this.removeCurrentWorkFromQueue();
                return true;
            }
            const res = this.build(target);
            if (res == ERR_NOT_IN_RANGE) {
                this.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
                return false;
            }
            else if (res == OK) {
                // 只有这一下会把工地打满时才在下一 tick 触发 onBuild；
                // 否则每个建造 tick 都会重复触发。
                const buildPower = this.getActiveBodyparts(WORK) * BUILD_POWER;
                if (target.progress + buildPower >= target.progressTotal) {
                    this.room.registEvent({
                        triggerTime: Game.time + 1,
                        triggerFunc: "buildOver",
                        param: [target.pos.x, target.pos.y]
                    });
                }
                return false;
            }
            else {
                this.removeCurrentWorkFromQueue();
                // this.releaseCurrentWork()   
                this.room.buildOver(target.pos.x, target.pos.y);
                return true;
            }
        }
        else {
            this.changeRole('emptyWorker');
            // this.room.registTask(getEnergyWithStorage(this.room))
            return true;
        }
    }
    /**
     * 按房间名走到相邻房间的出口。
     * 返回值表示"能不能到达"：已在目标房、已发出移动、站在出口格上都返回 true，
     * 只有真的无路（ERR_NO_PATH / 找不到出口格）才返回 false。
     * 出口方向按房间对缓存到 global（地形静态，推代码时随 global 一起丢弃）。
     */
    moveToRoom(roomName) {
        var _a;
        if (this.room.name === roomName) {
            return true;
        }
        const cache = (_a = global.roomExit) !== null && _a !== void 0 ? _a : (global.roomExit = {});
        const key = `${this.room.name}>${roomName}`;
        let exitDir = cache[key];
        if (exitDir === undefined) {
            exitDir = this.room.findExitTo(roomName);
            cache[key] = exitDir;
        }
        if (exitDir === ERR_NO_PATH) {
            return false;
        }
        const exits = this.room.find(exitDir);
        const exitPos = this.pos.findClosestByRange(exits);
        if (!exitPos) {
            return false;
        }
        if (this.pos.isEqualTo(exitPos)) {
            // 站在出口格上，回合结束引擎会自动把 creep 送到隔壁房间
            return true;
        }
        this.moveTo(exitPos, { visualizePathStyle: { stroke: '#00ffff' } });
        return true;
    }
    /**
     * 外矿常驻采集。永远返回 false：任务持有到 creep 死亡，
     * 死亡后由主房队列清理预约、由 refreshRemoteSpawn 按门槛补员。
     * taskParam: [sourceId | null, 外矿房名, 主房名]
     */
    remoteHarvest(sourceId, targetRoom, homeRoom) {
        if (this.room.name !== targetRoom) {
            this.moveToRoom(targetRoom);
            return false;
        }
        let source = sourceId ? Game.getObjectById(sourceId) : undefined;
        if (!source && this.memory.harvestSourceId) {
            source = Game.getObjectById(this.memory.harvestSourceId);
        }
        if (!source) {
            // 第一次进来（还没有矿点缓存）：自己挑最近的矿点并写回缓存
            source = this.pos.findClosestByRange(FIND_SOURCES);
            if (!source) {
                return false;
            }
            this.memory.harvestSourceId = source.id;
        }
        const state = this.remoteSourceState(homeRoom, targetRoom, source);
        const container = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (object) => object.structureType === STRUCTURE_CONTAINER
        })[0];
        if (container) {
            if (state && state.containerId !== container.id) {
                state.containerId = container.id;
            }
            if (state && (!state.containerPos || state.containerPos[0] !== container.pos.x || state.containerPos[1] !== container.pos.y)) {
                state.containerPos = [container.pos.x, container.pos.y];
            }
            if (!this.pos.isEqualTo(container.pos)) {
                this.moveTo(container.pos, { visualizePathStyle: { stroke: '#ffffff' } });
                return false;
            }
            // container 掉血时优先修：采集溢出的能量会先进自己背包，正好当维修费
            if (container.hits < container.hitsMax * remoteSetting.repairThreshold
                && this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.say('🔧修外矿');
                if (this.repair(container) === ERR_NOT_IN_RANGE) {
                    this.moveTo(container.pos, { visualizePathStyle: { stroke: '#ffffff' } });
                }
                return false;
            }
            this.say('⛏️外矿采矿');
            if (this.harvest(source) === ERR_NOT_IN_RANGE) {
                this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } });
            }
            return false;
        }
        // 还没有 container：自己放工地并建造（5000 进度，边采边建）
        let site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: (object) => object.structureType === STRUCTURE_CONTAINER
        })[0];
        if (!site) {
            const pos = this.remoteContainerPos(source, homeRoom);
            if (pos) {
                if (state && (!state.containerPos || state.containerPos[0] !== pos.x || state.containerPos[1] !== pos.y)) {
                    state.containerPos = [pos.x, pos.y];
                }
                if (pos.createConstructionSite(STRUCTURE_CONTAINER) === OK) {
                    site = pos.lookFor(LOOK_CONSTRUCTION_SITES)
                        .find(item => item.structureType === STRUCTURE_CONTAINER);
                }
            }
        }
        if (site) {
            if (this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                this.say('🔨造外矿container');
                if (this.build(site) === ERR_NOT_IN_RANGE) {
                    this.moveTo(site, { visualizePathStyle: { stroke: '#ffffff' } });
                }
                return false;
            }
            this.say('⛏️攒能量');
            if (this.harvest(source) === ERR_NOT_IN_RANGE) {
                this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } });
            }
            return false;
        }
        // 放不了工地（被占/没有可走格）：贴着矿点采，溢出能量落在地上
        this.say('⛏️外矿采矿');
        if (!this.pos.inRangeTo(source, 1)) {
            this.moveTo(source, { visualizePathStyle: { stroke: '#ffffff' } });
        }
        else {
            this.harvest(source);
        }
        return false;
    }
    /**
     * 外矿运输：去外矿 container 取能，回到主房投递后才结束任务。
     * 只有回到主房才能返回 true —— releaseCurrentWork 用的是 this.room 的队列，
     * 在外矿房结束任务会把主房队列里的预约漏掉。
     */
    remoteCarry(containerId, targetRoom, homeRoom, sinkId) {
        const energy = this.store.getUsedCapacity(RESOURCE_ENERGY);
        if (this.room.name === targetRoom) {
            if (this.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                const container = Game.getObjectById(containerId);
                if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    this.memory.remoteReturn = true;
                    this.say('🫳外矿取能');
                    if (this.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        this.moveTo(container, { visualizePathStyle: { stroke: '#ffff00' } });
                    }
                    return false;
                }
            }
            // 拿满了 / 外矿没货：标记回程，回主房再结算
            this.memory.remoteReturn = true;
            this.moveToRoom(homeRoom);
            return false;
        }
        if (this.room.name !== homeRoom) {
            // 走廊房间：有货或已在回程就回家，否则去外矿
            this.moveToRoom(energy > 0 || this.memory.remoteReturn ? homeRoom : targetRoom);
            return false;
        }
        // 已经回到主房
        if (!energy) {
            if (!this.memory.remoteReturn) {
                // 刚在主房认领任务，空背包是正常起点：先去外矿取能
                this.moveToRoom(targetRoom);
                return false;
            }
            // 空手回来 = 外矿没货，任务作废（在家才能安全地按房间删任务）
            this.removeCurrentWorkFromQueue();
            delete this.memory.remoteReturn;
            return true;
        }
        const sink = sinkId ? Game.getObjectById(sinkId) : undefined;
        const target = sink && sink.store && sink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            ? sink
            : this.homeEnergySink();
        if (target) {
            this.say('⚡外矿回运');
            if (this.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                this.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
                return false;
            }
        }
        delete this.memory.remoteReturn;
        return true;
    }
    /**
     * 侦察兵常驻任务：从外矿计划里挑需要情报的房间，走过去写情报；
     * 没有目标时回主房随机走，等待 autoplan 以后新增的房间。
     * 一直返回 false，只有主房关掉外矿时才回主房释放任务。
     */
    scout(homeRoom) {
        var _a;
        const plan = (_a = Memory.remotePlan) === null || _a === void 0 ? void 0 : _a[homeRoom];
        if (!plan || plan.enabled === false) {
            // 外矿总开关关了：回主房释放任务（releaseCurrentWork 用的是主房队列）
            if (this.room.name === homeRoom) {
                return true;
            }
            this.moveToRoom(homeRoom);
            return false;
        }
        const target = this.memory.scoutTarget;
        if (target) {
            if (this.room.name === target) {
                this.say('👁️侦察完毕');
                recordRoomIntel(homeRoom, this.room);
                delete this.memory.scoutTarget;
                return false;
            }
            // 侦察兵只支持在相邻房之间导航：先回主房，再从主房去目标
            if (this.room.name !== homeRoom) {
                this.moveToRoom(homeRoom);
                return false;
            }
            if (!this.moveToRoom(target)) {
                // 从主房都走不到：当作不可用，避免反复派同一个房
                this.markScoutUnreachable(homeRoom, target);
                delete this.memory.scoutTarget;
            }
            return false;
        }
        // 没有目标时先回主房待命，避免留在外矿房没法接新任务
        if (this.room.name !== homeRoom) {
            this.moveToRoom(homeRoom);
            return false;
        }
        const next = this.pickScoutTarget(homeRoom);
        if (next) {
            this.memory.scoutTarget = next;
            this.say('👁️去侦察');
            this.moveToRoom(next);
            return false;
        }
        // 没活：原地随便走走，等新任务
        this.randomWalk();
        return false;
    }
    /**
     * 从计划里挑一个还没有情报的房：没 sources、没被标记 unsafe、也没探过。
     */
    pickScoutTarget(homeRoom) {
        var _a, _b;
        const plan = (_a = Memory.remotePlan) === null || _a === void 0 ? void 0 : _a[homeRoom];
        if (!(plan === null || plan === void 0 ? void 0 : plan.rooms)) {
            return undefined;
        }
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName];
            if (!state || state.enabled === false) {
                continue;
            }
            if (state.sources && Object.keys(state.sources).length) {
                continue;
            }
            const intel = (_b = Memory.mapIntel) === null || _b === void 0 ? void 0 : _b[roomName];
            if ((intel === null || intel === void 0 ? void 0 : intel.unsafe) || (intel === null || intel === void 0 ? void 0 : intel.scoutedAt)) {
                continue;
            }
            return roomName;
        }
        return undefined;
    }
    /**
     * 侦察兵从主房都走不到的房间：记成 unsafe，之后不再自动选它。
     */
    markScoutUnreachable(homeRoom, roomName) {
        var _a, _b, _c, _d;
        if (!Memory.mapIntel) {
            Memory.mapIntel = {};
        }
        const intel = (_a = Memory.mapIntel[roomName]) !== null && _a !== void 0 ? _a : (Memory.mapIntel[roomName] = {});
        intel.scoutedAt = Game.time;
        intel.unsafe = true;
        const state = (_d = (_c = (_b = Memory.remotePlan) === null || _b === void 0 ? void 0 : _b[homeRoom]) === null || _c === void 0 ? void 0 : _c.rooms) === null || _d === void 0 ? void 0 : _d[roomName];
        if (state) {
            state.enabled = false;
        }
    }
    /**
     * 侦察兵待命时的随机移动：只在本房间内走，不跨出口。
     */
    randomWalk() {
        const directions = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
        const delta = {
            [TOP]: [-1, 0],
            [TOP_RIGHT]: [-1, 1],
            [RIGHT]: [0, 1],
            [BOTTOM_RIGHT]: [1, 1],
            [BOTTOM]: [1, 0],
            [BOTTOM_LEFT]: [1, -1],
            [LEFT]: [0, -1],
            [TOP_LEFT]: [-1, -1],
        };
        const dir = directions[Math.floor(Math.random() * directions.length)];
        const [dx, dy] = delta[dir];
        const x = this.pos.x + dx;
        const y = this.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) {
            return;
        }
        if (this.room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) {
            return;
        }
        this.move(dir);
    }
    /**
     * 把当前矿点登记进顶层 Memory.remotePlan，供主房扫描同步任务/补员。
     */
    remoteSourceState(homeRoom, targetRoom, source) {
        var _a, _b;
        const plan = (_a = Memory.remotePlan) === null || _a === void 0 ? void 0 : _a[homeRoom];
        const state = (_b = plan === null || plan === void 0 ? void 0 : plan.rooms) === null || _b === void 0 ? void 0 : _b[targetRoom];
        if (!state) {
            return undefined;
        }
        if (!state.sources) {
            state.sources = {};
        }
        if (!state.sources[source.id]) {
            state.sources[source.id] = {};
        }
        return state.sources[source.id];
    }
    /**
     * 给外矿矿点挑 container 位置：贴着矿点、能走、尽量靠近回主房的出口。
     */
    remoteContainerPos(source, homeRoom) {
        var _a;
        const terrain = this.room.getTerrain();
        let anchor;
        const exitRes = this.room.findExitTo(homeRoom);
        if (exitRes !== ERR_NO_PATH) {
            const exits = this.room.find(exitRes);
            anchor = (_a = this.pos.findClosestByRange(exits)) !== null && _a !== void 0 ? _a : undefined;
        }
        if (!anchor) {
            anchor = this.pos;
        }
        const offsets = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];
        let best;
        let bestRange = Infinity;
        for (const [dx, dy] of offsets) {
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                continue;
            }
            const pos = new RoomPosition(x, y, this.room.name);
            // 已经有别的建筑/工地就跳过，避免重复放工地
            if (pos.lookFor(LOOK_STRUCTURES).length || pos.lookFor(LOOK_CONSTRUCTION_SITES).length) {
                continue;
            }
            const range = pos.getRangeTo(anchor);
            if (range < bestRange) {
                bestRange = range;
                best = pos;
            }
        }
        return best;
    }
    /**
     * 外矿 carrier 没任务时的兜底：不在主房就先回去，在主房就把能量交给接收点。
     * 任务可能被别人 removeCurrentWorkFromQueue 踢掉，保证它不会带着货滞留在外矿房。
     */
    remoteCarrierIdle() {
        if (this.room.name !== this.memory.spawnRoom) {
            this.moveToRoom(this.memory.spawnRoom);
            return false;
        }
        if (this.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            const sink = this.homeEnergySink();
            if (sink) {
                this.transfer(sink, RESOURCE_ENERGY);
            }
        }
        return false;
    }
    /**
     * 主房接收外矿能量的备选目标：storage 优先，其次任意有空位的 container，
     * 最后直接补给 spawn/extension（主房还没建 container 时也能回运）。
     */
    homeEnergySink() {
        if (this.room.storage && this.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            return this.room.storage;
        }
        for (const id of this.room.getContainer()) {
            const container = Game.getObjectById(id);
            if (container && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                return container;
            }
        }
        for (const id of this.room.energyStructureOrder()) {
            const structure = Game.getObjectById(id);
            if (structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                return structure;
            }
        }
        return undefined;
    }
}

/**
 * 把 obj2 的原型合并到 obj1 的原型上
 * 如果原型的键以 Getter 结尾，则将会把其挂载为 getter 属性
 * @param obj1 要挂载到的对象
 * @param obj2 要进行挂载的对象
 */
const assignPrototype = function (obj1, obj2) {
    Object.getOwnPropertyNames(obj2.prototype).forEach(key => {
        if (key.includes('Getter')) {
            Object.defineProperty(obj1.prototype, key.split('Getter')[0], {
                get: obj2.prototype[key],
                enumerable: false,
                configurable: true
            });
        }
        else
            obj1.prototype[key] = obj2.prototype[key];
    });
};
/**
 * 根据身体配置生成完成的身体数组
 * cpu 消耗: 0.028 左右
 *
 * @param bodySet 身体部件配置对象
 */
function calcBodyPart(bodySet) {
    // 把身体配置项拓展成如下形式的二维数组
    // [ [ TOUGH ], [ WORK, WORK ], [ MOVE, MOVE, MOVE ] ]
    const bodys = Object.keys(bodySet).map(type => Array(bodySet[type]).fill(type));
    // 把二维数组展平
    return [].concat(...bodys);
}
/**
 * creep 走一格需要的 tick 数。
 * 每 tick 恢复 2 * MOVE 数量点疲劳，走一格增加 (总部件数 - MOVE 数) 点疲劳。
 */
function calcTicksPerTile(body) {
    const moveParts = body.filter(part => part === MOVE).length;
    if (!moveParts) {
        return 20;
    }
    const weight = body.length - moveParts;
    return Math.max(1, Math.ceil(weight / (moveParts * 2)));
}
/**
 * 单个 spawn 孵化这个身体需要的 tick 数
 */
function calcSpawnTicks(body) {
    return body.length * CREEP_SPAWN_TIME;
}
function CalBodyCost(bodys) {
    let cost = 0;
    if (!bodys) {
        console.log("怎么会有空的bodys？");
        return;
    }
    for (let body of bodys) {
        cost += BODYPART_COST[body];
    }
    return cost;
}
/**
 *
 * @param role
 * @param room
 */
function getBody(role, room) {
    switch (role) {
        case 'harvester':
            return getHarvesterBody(room);
        case 'carrier':
            return getCarrierBody(room);
        case 'worker':
            return getWorkerBody(room);
        case 'claimer':
            return getClaimerBody(room);
        case 'attacker':
            return getAttackerBody(room);
        case 'viewer':
            return getViewerBody();
        case 'remoteBuilder':
            return getWorkerBody(room);
        case 'remoteHarvester':
            // 外矿和主房一样是站在 container 上采，body 直接复用
            return getHarvesterBody(room);
        case 'remoteCarrier':
            // 外矿运输和本地 carrier 一样是纯搬货，body 直接复用
            return getCarrierBody(room);
    }
}
/**
 //  * 返回harvester的body
 //  * @param room
 //  * @returns
 //  */
const getHarvesterBody = function (room) {
    // CARRY 保持最小：站在 container 上采集时，溢出的能量由引擎自动填进脚下 container，
    // 不需要转身卸货，采集不会被打断。
    // 体型按「容量」而不是当前存量算：harvester 寿命长，按当前能量算会在低能量时
    // 孵出最小体型，形成“能量低 → 弱 harvester → 能量更低”的死循环。
    // spawn 会等能量攒够再孵化，换班余量（孵化 + 路程 + 15 tick）足够。
    const energyBase = room.energyCapacityAvailable;
    let num = Math.floor((energyBase - 50) / 250);
    if (num > 3) {
        num = 3;
    }
    if (num <= 0) {
        num = 1;
    }
    return calcBodyPart({ [CARRY]: 1, [WORK]: 2 * num, [MOVE]: num });
};
const getCarrierBody = function (room) {
    let body;
    // 和 worker/harvester 一致：按容量算，避免低能量时孵出 1 CARRY 的“残废” carrier，
    // 一次只能搬 50 能量、来回跑断腿。
    const energyBase = room.energyCapacityAvailable * spawnPercent;
    let num = Math.floor(energyBase / 100);
    if (num > 25)
        num = 25;
    if (num <= 0)
        num = 1;
    body = calcBodyPart({ [CARRY]: num, [MOVE]: num });
    return body;
};
const getWorkerBody = function (room) {
    let body;
    let num = Math.floor((room.energyCapacityAvailable * spawnPercent - 150) / 150);
    if (num > 23)
        num = 23;
    if (num <= 0)
        num = 1;
    body = calcBodyPart({ [CARRY]: 3, [WORK]: num, [MOVE]: num });
    return body;
};
const getClaimerBody = function (room) {
    let body;
    let num = Math.floor((room.energyCapacityAvailable * spawnPercent) / 750);
    if (num > 12)
        num = 12;
    if (num <= 0)
        num = 1;
    body = calcBodyPart({ [CLAIM]: num, [MOVE]: num * 3 });
    return body;
};
const getAttackerBody = function (room) {
    let body;
    let num = Math.floor((room.energyCapacityAvailable * spawnPercent) / 200);
    if (num > 10)
        num = 10;
    if (num <= 0)
        num = 1;
    body = calcBodyPart({ [TOUGH]: num * 2, [MOVE]: num * 2, [ATTACK]: num });
    return body;
};
/**
 * 兜底体型：按当前可用能量算一个刚好买得起的身体。
 * 正常孵化仍然走 getBody 按容量算体型（避免低能量时孵出弱 creep）；
 * 这里只给 spawn 队列在"等能量等太久"时保底用，保证房间至少能孵出一个 creep 破局。
 * 连最小体型都买不起时返回 undefined。
 */
function getBodyForEnergy(role, room, energy) {
    const budget = Math.min(energy, room.energyCapacityAvailable);
    switch (role) {
        case 'harvester':
        case 'remoteHarvester': {
            // 和 getHarvesterBody 同构，只是能量基准换成当前可用量
            const num = Math.floor((budget - 50) / 250);
            if (num <= 0) {
                return undefined;
            }
            return calcBodyPart({ [CARRY]: 1, [WORK]: 2 * Math.min(num, 3), [MOVE]: Math.min(num, 3) });
        }
        case 'carrier':
        case 'remoteCarrier': {
            const num = Math.floor(budget / 100);
            if (num <= 0) {
                return undefined;
            }
            return calcBodyPart({ [CARRY]: Math.min(num, 25), [MOVE]: Math.min(num, 25) });
        }
        case 'worker':
        case 'remoteBuilder': {
            const num = Math.floor((budget - 150) / 150);
            if (num <= 0) {
                return undefined;
            }
            return calcBodyPart({ [CARRY]: 3, [WORK]: Math.min(num, 23), [MOVE]: Math.min(num, 23) });
        }
        case 'viewer':
            return budget >= 100 ? calcBodyPart({ [MOVE]: 2 }) : undefined;
        case 'claimer': {
            const num = Math.floor(budget / 750);
            return num > 0 ? calcBodyPart({ [CLAIM]: num, [MOVE]: num * 3 }) : undefined;
        }
        case 'attacker': {
            const num = Math.floor(budget / 200);
            return num > 0 ? calcBodyPart({ [TOUGH]: num * 2, [MOVE]: num * 2, [ATTACK]: num }) : undefined;
        }
        default:
            return undefined;
    }
}
const getViewerBody = function (room) {
    let body;
    // 侦察兵只要移动：2 个 MOVE 走 2 格/tick，100 能量，探完原地待命
    body = calcBodyPart({ [MOVE]: 2 });
    return body;
};
function initializeArray(rows, cols) {
    let array = [];
    for (let i = 0; i < rows; i++) {
        array[i] = [];
        for (let j = 0; j < cols; j++) {
            array[i][j] = 0;
        }
    }
    return array;
}
// /**
//  * 参考linux内核优先级队列
//  * 使用位图计算最高优先级数组对应的下标.下标越低优先级越高，从0开始
//  * @param x 输入的位图数字
//  * @return 返回优先级数组的索引
//  */
// export function findFirstBit(x: number): number {
//     let r = 0
//     // console.log("find first bit", x, r)
//     if (!(x & 0xf)) {
//         x >>= 4
//         r += 4
//     }
//     // console.log("find first bit", x, r)
//     if (!(x & 3)) {
//         x >>= 2
//         r += 2
//     }
//     // console.log("find first bit", x, r)
//     if (!(x & 1)) {
//         r += 1
//     }
//     // console.log("find first bit", x, r)
//     return r;
// }
//
// /**
//  * 将data push入data池，并添加相应的优先级以及计数
//  * @param role 对应的角色
//  * @param data CreepData
//  * @param priority 对应的优先级，从0到3，越小优先级越高
//  */
// export function pushPool(role: DataConstant, data: TotalData, priority: number = 1) {
//     // console.log(role)
//     if(this.memory.dataPool[role]==undefined) {
//         this.memory.dataPool[role].listLength = 1
//     } else {
//         this.memory.dataPool[role].listLength += 1
//     }
//
//     if(!this.memory.dataPool[role].list[priority]) {
//         this.memory.dataPool[role].list[priority] = []
//     }
//     this.memory.dataPool[role].list[priority].push({
//         data: data,
//     })
//     this.memory.dataPool[role].bitmap |= Math.pow(2, priority)
// }
//
// /**
//  * 从data池中查找当前优先度最高的列表中的data给creep
//  * 没有处理列表为空的时候的情况
//  * 当列表为空的时候会返回undefined
//  * @param role 对应的role
//  */
// export function popPool(role: DataConstant) {
//     if (this.memory.dataPool[role].listLength == 0) {
//         return
//     } else {
//         let priority = findFirstBit(this.memory.dataPool[role].bitmap)
//         // console.log("priority", this.memory.dataPool[role].listLength, priority, this.memory.dataPool[role].bitmap)
//         if(priority>4) {
//             return
//         }
//         this.memory.dataPool[role].listLength -= 1
//
//         let data = this.memory.dataPool[role].list[priority].shift().data
//         if (this.memory.dataPool[role].list[priority].length == 0) {
//             this.memory.dataPool[role].bitmap &= ~(1 << priority)
//         }
//         return data
//     }
// }
//
// export function getPool(role: DataConstant) {
//     if (this.memory.dataPool[role].listLength == 0) {
//         return
//     } else {
//         let priority = findFirstBit(this.memory.dataPool[role].bitmap)
//         // console.log("priority", this.memory.dataPool[role].listLength, priority, this.memory.dataPool[role].bitmap)
//         if(priority>4) {
//             return
//         }
//         let data = this.memory.dataPool[role].list[priority][0].data
//         return data
//     }
//
// }

var mountCreep = () => {
    console.log("+ Mounting Creep extension");
    assignPrototype(Creep, CreepExtension);
};

const plan1 = [
    "e5 e5 e5 e4 e4 r4 e4 e4 e3 e3 e3",
    "e5 r5 r5 e5 r5 e4 r4 e4 e3 r4 e3",
    "e5 e5 e5 r5 s7 n8 t5 r4 e2 r4 e2",
    "e6 e5 r5 e5 r5 e4 t7 t3 r4 e2 e2",
    "e6 r6 e6 e6 T6 r4 e4 r4 s1 r4 e2",
    "r6 e6 e6 p8 r6 S4 r4 e4 l6 l6 r4",
    "e6 r6 e6 r6 f7 r5 e4 l8 l6 r6 l7",
    "e7 e7 r6 e6 e6 L5 r6 l8 r6 l7 l7",
    "e7 r6 e7 r6 t8 t8 s8 r6 l8 l8 e8",
    "e7 r6 e7 e7 r6 t8 r6 e8 r6 r6 e8",
    "e7 e7 e7 e8 e8 r6 e8 e8 e8 e8 e8"
];
/**
 * 11*11 基地集群
 */
// export const totalCluster1 = [
//     "e5 e5 e5 e4 e4 r4 e4 e4 e3 e3 e3",
//     "e5 r5 r5 t7 r4 e4 r4 e4 e3 r3 e2",
//     "e5 e5 e5 r4 e4 e4 t5 r3 e3 r3 e2",
//     "e6 e5 r5 e5 r4 n8 e4 e4 r3 t3 e2",
//     "e6 r5 e6 e5 T6 r4 s7 r3 e2 r2 e2",
//     "r5 e6 e6 L5 r5 S4 r4 s1 l8 l8 r2",
//     "e6 r6 e6 r6 f7 r5 s8 l7 l7 r4 l8",
//     "e6 t8 r6 e7 e7 p8 r5 l6 r4 l7 l8",
//     "e6 r6 e7 r6 t8 e8 e8 r5 l6 l6 e8",
//     "e6 r6 e7 e7 r6 e8 r6 t8 r6 r6 e8",
//     "e7 e7 e7 e7 e7 r6 e8 e8 e8 e8 e8"
// ]
const plan2_Core = [
    "r5 e2 r5 t5 r5 e2 r5",
    "e2 r5 e2 r5 e2 r5 p8",
    "r5 n8 r5 T6 r5 e4 r5",
    "s1 r5 S4 r5 f7 r5 t3",
    "r5 e4 r5 L5 r5 e3 r5",
    "e4 r5 e3 r5 e3 r5 e3",
    "r5 e4 r5 t7 r5 e3 r5"
];
const plan2_Lab = [
    "N l7 l8 r7",
    "l7 l7 r7 l8",
    "l8 r7 l6 l6",
    "r7 l8 l6 N",
];
/**
 * 6*6 extension集群
 * 包含24个extension
 */
const plan2_extensionCluster1 = [
    "e4 e4 r4 r5 e5 e5",
    "e4 r4 e4 e5 r5 e5",
    "r4 e4 e4 e5 e5 r5",
    "r5 e5 e5 e5 s7 r6",
    "e6 r5 e5 e6 r6 e6",
    "e6 e6 r6 r6 e6 e6"
];
const plan2_extensionCluster2 = [
    "e6 e6 r7 r7 e7 e7",
    "e6 r7 e7 e7 r7 e7",
    "r7 e7 e7 e7 e7 r7",
    "r8 e7 e8 e8 s8 r7",
    "e8 r8 e8 e8 r8 e8",
    "e8 e8 r8 r8 e8 e8"
];
const mapping = {
    e: STRUCTURE_EXTENSION,
    r: STRUCTURE_ROAD,
    n: STRUCTURE_NUKER,
    s: STRUCTURE_SPAWN,
    t: STRUCTURE_TOWER,
    T: STRUCTURE_TERMINAL,
    S: STRUCTURE_STORAGE,
    L: STRUCTURE_LINK,
    l: STRUCTURE_LAB,
    p: STRUCTURE_POWER_SPAWN,
    f: STRUCTURE_FACTORY,
    o: STRUCTURE_OBSERVER,
    N: "Null"
};

/**
 * 试了好几遍还是不知道怎么在tick内传函数,干脆传函数名,统一挂载在room下得了
 * @constructor
 */
function showRoomPlanEvent(time, level) {
    return {
        triggerTime: time,
        triggerFunc: 'visualize',
        param: [level]
    };
}
function checkRoomLevelEvent(time) {
    return {
        triggerTime: time,
        triggerFunc: 'checkRoomLevel',
        param: []
    };
}
// /**
//  * autoPlan有关event
//  */
//
// export function Visual(room: Room, gameTime:number): myEvent {
//     room.visualize()
//     Game.rooms[room].visualize(totalCluster1, x, y)
//     return {
//         triggerTime: gameTime,
//         triggerFunc: 'visualize',
//         param: [room]
//     }
// }

class RoomExtension extends Room {
    /**
     * 初始化部分
     */
    init() {
        if (!this.memory.timer) {
            this.memory.timer = {};
        }
        // 暂时就分三种， 0是主基地，1是分基地也就是矿场，用于reserve，2是其他房间
        if (!this.controller) {
            this.memory.roomType = 2;
        }
        else {
            if (!this.controller.my) {
                this.memory.roomType = 2;
            }
            else {
                this.memory.roomType = 0;
                this.globalReset();
            }
        }
    }
    globalReset() {
        if (!this.controller || !this.controller.my) {
            return;
        }
        global.room[this.name] = {};
        this.memory.creepTask = {
            'harvestTask': {},
            'workTask': {},
            'carryTask': {},
            'upgradeTask': {},
            'constructTask': {},
            'repairTask': {},
            'wallRepairTask': {},
            'energyTask': {},
            'spawnTask': {},
            'remoteHarvestTask': {},
            'remoteCarryTask': {},
            'scoutTask': {}
        };
        this.initResource();
        this.initBuildList();
        this.initSpawn(this.controller.level);
        this.initTask(this.controller.level);
        this.initCarryList();
        this.initCreepRecycle();
        // 房间初始化（含新 claim 的房和推代码重建）时自动配好相邻外矿计划
        this.syncRemotePlan();
        this.registEvent(checkRoomLevelEvent(Game.time + 1));
    }
    initBuildList() {
        if (this.memory.creepTask) {
            this.memory.creepTask['constructTask'] = {};
        }
        this.construct(this.controller.level);
        // 确保矿点 container 工地存在：已有 container 会被直接复用，不会另起新点
        this.containerPos();
        // 布局完成后计算 spawn 到各矿点的距离，供 harvester 提前换班使用
        this.cacheHarvestSpawnDistances();
        const constructionSites = this.find(FIND_CONSTRUCTION_SITES);
        this.registTask(createBuildTask(constructionSites));
    }
    /**
     * 布局阶段计算 spawn 到每个矿点的路径长度，存进 Memory。
     * spawn 位置不变时直接复用缓存，避免频繁寻路。
     */
    cacheHarvestSpawnDistances() {
        const spawn = this.find(FIND_MY_SPAWNS)[0];
        if (!spawn) {
            return;
        }
        const spawnPos = spawn.pos;
        const storedPos = this.memory.harvestSpawnPos;
        if (storedPos && storedPos[0] === spawnPos.x && storedPos[1] === spawnPos.y
            && this.memory.harvestSpawnDistance) {
            return;
        }
        const distances = {};
        for (const sourceId of this.sources()) {
            const source = Game.getObjectById(sourceId);
            if (!source) {
                continue;
            }
            distances[sourceId] = this.findPath(spawnPos, source.pos, { ignoreCreeps: true }).length;
        }
        this.memory.harvestSpawnDistance = distances;
        this.memory.harvestSpawnPos = [spawnPos.x, spawnPos.y];
    }
    initResource() {
        const resources = this.find(FIND_DROPPED_RESOURCES);
        global.room[this.name].resources = resources;
    }
    initCreepRecycle() {
        for (const creep of this.find(FIND_MY_CREEPS)) {
            this.registEvent({
                triggerTime: Game.time + creep.ticksToLive + 1,
                triggerFunc: "creepRecycle",
                param: []
            });
        }
    }
    normalizeTaskBuckets(taskType) {
        if (!this.memory.creepTask) {
            return {};
        }
        let buckets = this.memory.creepTask[taskType];
        if (!buckets) {
            buckets = {};
            this.memory.creepTask[taskType] = buckets;
        }
        return buckets;
    }
    initCarryList() {
        if (!this.memory.creepTask) {
            return;
        }
        // 只从 spawn/extension 登记表里取，不再每 tick find。
        // tower 不放进这张表，它走 ensureEnergyCarryTask 的 60% 阈值补能。
        const structureList = this.energyStructureOrder()
            .map(id => Game.getObjectById(id))
            .filter((structure) => !!structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        this.registTask(getCarryList(structureList, RESOURCE_ENERGY));
    }
    refreshEnergyCarryTasks() {
        var _a, _b;
        if (!this.memory.creepTask) {
            return;
        }
        // 直接遍历 spawn/extension 登记表，状态实时读 store，不再 find
        const structureList = this.energyStructureOrder()
            .map(id => Game.getObjectById(id))
            .filter((structure) => !!structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        const carryBuckets = this.normalizeTaskBuckets('carryTask');
        // 只清理 spawn/extension 自己的补能任务；塔等其它目标的任务不能动，
        // 它们由各自的触发逻辑（ensureEnergyCarryTask）管理。
        const orderIds = new Set(this.energyStructureOrder());
        const neededIds = new Set(structureList.map(item => item.id));
        const existingIds = new Set();
        for (const key in carryBuckets) {
            const bucket = carryBuckets[key];
            if (!bucket || !bucket.length) {
                delete carryBuckets[key];
                continue;
            }
            const nextBucket = [];
            for (const task of bucket) {
                if (!task) {
                    continue;
                }
                const taskTargetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
                if (!taskTargetId) {
                    continue;
                }
                if (orderIds.has(taskTargetId) && !neededIds.has(taskTargetId)) {
                    // 这个 spawn/extension 已经满了，任务作废
                    continue;
                }
                if (neededIds.has(taskTargetId)) {
                    existingIds.add(taskTargetId);
                }
                nextBucket.push(task);
            }
            if (nextBucket.length) {
                carryBuckets[key] = nextBucket;
            }
            else {
                delete carryBuckets[key];
            }
        }
        this.memory.creepTask['carryTask'] = carryBuckets;
        const toAdd = structureList.filter(item => !existingIds.has(item.id));
        if (toAdd.length) {
            this.registTask(getCarryList(toAdd, RESOURCE_ENERGY));
        }
    }
    /**
     * 按布局集群顺序返回 spawn/extension 的固定 id 列表。
     * 顺序在布局阶段就由 plan1/plan2 的数组顺序决定，和存量无关。
     */
    energyStructureOrder() {
        if (!global.room[this.name]) {
            global.room[this.name] = {};
        }
        if (!global.room[this.name].energyStructureOrder) {
            return this.buildEnergyStructureOrder();
        }
        return global.room[this.name].energyStructureOrder;
    }
    /**
     * 重建能量结构顺序：
     * - plan2: Core -> extensionCluster1 -> extensionCluster2（和建造顺序一致）
     * - plan1: 整个 plan1 行优先
     * - 不在布局里的结构追加到最后，按到 spawn 的距离排
     */
    buildEnergyStructureOrder() {
        const rankMap = {};
        let rank = 0;
        const addPlan = (map, anchor, plusOne = true) => {
            if (!anchor || !map) {
                return;
            }
            // 与 buildLayout / constructPlan1 的坐标计算保持一致
            const offset = plusOne ? map.length - 1 : map.length;
            for (let y = 0; y < map.length; y++) {
                const row = map[y].split(" ");
                for (let x = 0; x < row.length; x++) {
                    const cell = row[x];
                    if (!cell) {
                        continue;
                    }
                    const type = mapping[cell[0]];
                    if (type !== STRUCTURE_EXTENSION && type !== STRUCTURE_SPAWN) {
                        continue;
                    }
                    rankMap[`${anchor[0] + x - offset},${anchor[1] + y - offset}`] = rank++;
                }
            }
        };
        if (this.memory.roomPlanType === 2 && this.memory.plan2Pos) {
            const planPos = this.memory.plan2Pos;
            addPlan(plan2_Core, planPos.core);
            addPlan(plan2_extensionCluster1, planPos.ext1);
            addPlan(plan2_extensionCluster2, planPos.ext2);
        }
        else if (this.memory.plan1Pos) {
            addPlan(plan1, this.memory.plan1Pos, false);
        }
        const structures = this.find(FIND_MY_STRUCTURES, {
            filter: (object) => object.structureType === STRUCTURE_SPAWN
                || object.structureType === STRUCTURE_EXTENSION
        });
        const spawn = this.find(FIND_MY_SPAWNS)[0];
        const spawnPos = spawn ? spawn.pos : undefined;
        structures.sort((a, b) => {
            const rankA = rankMap[`${a.pos.x},${a.pos.y}`];
            const rankB = rankMap[`${b.pos.x},${b.pos.y}`];
            const aPlanned = rankA !== undefined;
            const bPlanned = rankB !== undefined;
            if (aPlanned && bPlanned && rankA !== rankB) {
                return rankA - rankB;
            }
            if (aPlanned !== bPlanned) {
                return aPlanned ? -1 : 1;
            }
            const distanceA = spawnPos ? a.pos.getRangeTo(spawnPos) : 0;
            const distanceB = spawnPos ? b.pos.getRangeTo(spawnPos) : 0;
            if (distanceA !== distanceB) {
                return distanceA - distanceB;
            }
            if (a.pos.y !== b.pos.y) {
                return a.pos.y - b.pos.y;
            }
            return a.pos.x - b.pos.x;
        });
        const order = structures.map(structure => structure.id);
        global.room[this.name].energyStructureOrder = order;
        return order;
    }
    /**
     * 新建的 spawn/extension 加入顺序表；已经在表里则不动。
     */
    registerEnergyStructure(id) {
        if (!global.room[this.name]) {
            global.room[this.name] = {};
        }
        const order = global.room[this.name].energyStructureOrder;
        if (order && order.includes(id)) {
            return;
        }
        this.buildEnergyStructureOrder();
    }
    /**
     * 定期兜底重建顺序表，处理漏掉的建成/拆除。
     */
    refreshEnergyStructures() {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return;
        }
        this.buildEnergyStructureOrder();
    }
    /**
     * 按布局固定顺序挑出"刚好够" cost 的结构，不做任何按存量排序。
     * spawnCreep 会严格按返回顺序扣能量，usedIds 就是实际贡献了能量的结构。
     */
    pickEnergyStructures(cost) {
        let result = this.selectEnergyStructures(this.energyStructureOrder(), cost);
        if (!result) {
            // 顺序表可能漏了刚建好的结构，强制重建一次再试
            result = this.selectEnergyStructures(this.buildEnergyStructureOrder(), cost);
        }
        if (result) {
            return result;
        }
        // 最后兜底：直接用房间里的全部 spawn/extension
        const all = this.find(FIND_MY_STRUCTURES, {
            filter: (object) => object.structureType === STRUCTURE_SPAWN
                || object.structureType === STRUCTURE_EXTENSION
        });
        return this.selectEnergyStructures(all.map(structure => structure.id), cost);
    }
    selectEnergyStructures(ids, cost) {
        let energy = 0;
        const structures = [];
        const usedIds = [];
        for (const id of ids) {
            if (energy >= cost) {
                break;
            }
            const structure = Game.getObjectById(id);
            if (!structure) {
                continue;
            }
            const stored = structure.store.getUsedCapacity(RESOURCE_ENERGY);
            if (!stored) {
                continue;
            }
            structures.push(structure);
            usedIds.push(id);
            energy += stored;
        }
        if (energy < cost) {
            return;
        }
        return { structures, usedIds };
    }
    /**
     * spawn 成功后 +1 tick 调用：spawnCreep 是 intent，回合末才扣能量，
     * 下一 tick 这些结构才会真正出现空位。只给实际贡献了能量的结构登记 carry 任务。
     */
    refillAfterSpawn(structureIds) {
        if (!structureIds || !structureIds.length) {
            return;
        }
        this.addExtensionCarryTasks(structureIds);
    }
    /**
     * 定期刷新取能任务：先剔除失效任务，再补缺失的目标。
     * 以前只加不删，墓碑/掉落物消失后会留下永久的死任务。
     */
    refreshEnergyTasks() {
        var _a, _b, _c, _d, _e, _f;
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return;
        }
        const level = this.controller.level;
        const watermark = (_a = containerWatermark[level]) !== null && _a !== void 0 ? _a : containerWatermark[0];
        // 先算出这一轮应有的任务，既用来补缺，也用来同步已有任务的并发数
        const tasks = getEnergyTask(this);
        const desired = {};
        for (const task of tasks) {
            const targetId = (_b = task.targetId) !== null && _b !== void 0 ? _b : (_c = task.taskParam) === null || _c === void 0 ? void 0 : _c[0];
            if (targetId) {
                desired[targetId] = task;
            }
        }
        const buckets = this.normalizeTaskBuckets('energyTask');
        const existingIds = new Set();
        for (const key in buckets) {
            const bucket = buckets[key];
            if (!bucket || !bucket.length) {
                delete buckets[key];
                continue;
            }
            const nextBucket = [];
            for (const task of bucket) {
                if (!task) {
                    continue;
                }
                const targetId = (_d = task.targetId) !== null && _d !== void 0 ? _d : (_e = task.taskParam) === null || _e === void 0 ? void 0 : _e[0];
                if (!targetId) {
                    continue;
                }
                const target = Game.getObjectById(targetId);
                // 目标已经不存在（墓碑/掉落物过期、结构被拆）直接删
                if (!target) {
                    continue;
                }
                const energy = this.energyOf(target);
                if (energy <= 0) {
                    continue;
                }
                const structureType = target.structureType;
                if (structureType === STRUCTURE_CONTAINER && energy < watermark.low) {
                    // 低于低水位，不再派人去取，留一点缓冲
                    continue;
                }
                if (structureType === STRUCTURE_STORAGE && energy <= storageSetting.reserveEnergy) {
                    continue;
                }
                // container 能量变化后并发数要跟着变
                const wanted = desired[targetId];
                if (wanted) {
                    task.capacity = (_f = wanted.capacity) !== null && _f !== void 0 ? _f : 1;
                }
                nextBucket.push(task);
                existingIds.add(targetId);
            }
            if (nextBucket.length) {
                buckets[key] = nextBucket;
            }
            else {
                delete buckets[key];
            }
        }
        this.memory.creepTask['energyTask'] = buckets;
        const toAdd = tasks.filter(task => {
            var _a, _b;
            const targetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
            return !!targetId && !existingIds.has(targetId);
        });
        if (toAdd.length) {
            this.registTask(toAdd);
        }
    }
    /**
     * 升级任务的并发数随工地状态变化：有工地用 RCL 基准值，
     * 工地清零后放开到实际 worker 数。只更新容量，不强踢已经预约的 worker，
     * 他们在下一次补能后会按新容量自然分流。
     */
    refreshUpgradeTask() {
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return;
        }
        const capacity = upgradeTaskCapacityOf(this);
        if (!capacity) {
            return;
        }
        const buckets = this.normalizeTaskBuckets('upgradeTask');
        for (const key in buckets) {
            const bucket = buckets[key];
            if (!bucket) {
                continue;
            }
            for (const task of bucket) {
                if (task && task.taskFunc === 'upgrade') {
                    task.capacity = capacity;
                    return;
                }
            }
        }
        // 任务被清掉了（例如推送代码后），补注册一条
        this.registTask(upgrade(this));
    }
    /**
     * 外矿任务同步（10 tick 一次）。
     * 任务统一登记在主房队列，creep 靠 memory.currentWork 跨房执行；
     * 外矿房本身不初始化、不建任务桶。
     */
    refreshRemoteTasks() {
        var _a, _b;
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return;
        }
        const plan = (_a = Memory.remotePlan) === null || _a === void 0 ? void 0 : _a[this.name];
        if (!plan || plan.enabled === false) {
            // 总开关关闭：清掉外矿任务桶。已经在外面的 creep 手里有任务副本，会干到死。
            for (const taskType of ['remoteHarvestTask', 'remoteCarryTask', 'scoutTask']) {
                if (this.memory.creepTask[taskType]) {
                    delete this.memory.creepTask[taskType];
                }
            }
            return;
        }
        // 侦察兵的常驻任务先挂上：新孵化/空闲的侦察兵靠它领活
        this.syncScoutTask();
        const harvestDesired = [];
        const carryDesired = [];
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName];
            if (!state || state.enabled === false) {
                continue;
            }
            const remoteRoom = Game.rooms[roomName];
            if (remoteRoom) {
                this.updateRemoteCache(state, remoteRoom);
            }
            const sourceIds = Object.keys((_b = state.sources) !== null && _b !== void 0 ? _b : {});
            if (!sourceIds.length) {
                // 还没情报的房交给侦察兵探路，不派 harvester 去盲跑
                continue;
            }
            harvestDesired.push(...getRemoteHarvestTasks(sourceIds, roomName, this.name));
            // 只有看得见外矿 container 里有能量时才登记运输任务，避免 carrier 白跑
            if (!remoteRoom || !state.sources) {
                continue;
            }
            const sinkId = this.remoteEnergySink();
            if (!sinkId) {
                continue;
            }
            for (const sourceId in state.sources) {
                const entry = state.sources[sourceId];
                if (!entry || !entry.containerId) {
                    continue;
                }
                const container = Game.getObjectById(entry.containerId);
                if (!container || container.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) {
                    continue;
                }
                carryDesired.push(...getRemoteCarryTasks(entry.containerId, roomName, this.name, sinkId));
            }
        }
        this.syncRemoteBucket('remoteHarvestTask', harvestDesired);
        this.syncRemoteBucket('remoteCarryTask', carryDesired);
        this.seedRemoteHarvestReservations();
        this.refreshScoutSpawn();
    }
    /**
     * 自动补全外矿计划：房间 init / 10 tick 扫描时调用。
     * - 第一次遇到这个房时创建总开关（enabled: true）
     * - 用户手动关掉总开关后不再自动加房
     * - 只补到 remoteSetting.maxRooms，unsafe 的房由 autoplan 排除
     */
    syncRemotePlan() {
        var _a, _b, _c;
        if (!this.controller || !this.controller.my) {
            return;
        }
        if (!Memory.remotePlan) {
            Memory.remotePlan = {};
        }
        const plan = (_a = Memory.remotePlan[this.name]) !== null && _a !== void 0 ? _a : (Memory.remotePlan[this.name] = { enabled: true, rooms: {} });
        if (!plan.rooms) {
            plan.rooms = {};
        }
        if (plan.enabled === false) {
            return;
        }
        let active = 0;
        for (const roomName in plan.rooms) {
            if (!((_c = (_b = Memory.mapIntel) === null || _b === void 0 ? void 0 : _b[roomName]) === null || _c === void 0 ? void 0 : _c.unsafe)) {
                active += 1;
            }
        }
        let capacity = remoteSetting.maxRooms - active;
        if (capacity <= 0) {
            return;
        }
        for (const roomName of planRemoteRooms(this.name)) {
            if (capacity <= 0) {
                break;
            }
            if (plan.rooms[roomName]) {
                continue;
            }
            plan.rooms[roomName] = {};
            capacity -= 1;
        }
    }
    /**
     * 常驻侦察任务：每个主房一个，capacity 1，priority 4（不挡富余能量门槛）。
     * 侦察兵认领后一直持有，内部自己从 plan 里挑下一个要探的房。
     */
    syncScoutTask() {
        const buckets = this.normalizeTaskBuckets('scoutTask');
        for (const key in buckets) {
            delete buckets[key];
        }
        buckets['4'] = [{
                id: `scout-${this.name}`,
                taskFunc: 'scout',
                taskParam: [this.name],
                priority: 4,
                capacity: 1,
                persistent: true,
                targetId: this.name,
                reservedBy: [],
            }];
    }
    /**
     * 有房间缺情报且没有存活/排队的侦察兵时，补一个 priority 4 的 viewer。
     */
    refreshScoutSpawn() {
        var _a, _b, _c, _d;
        const plan = (_a = Memory.remotePlan) === null || _a === void 0 ? void 0 : _a[this.name];
        if (!plan || plan.enabled === false) {
            return;
        }
        let needScout = false;
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName];
            if (!state || state.enabled === false) {
                continue;
            }
            if (state.sources && Object.keys(state.sources).length) {
                continue;
            }
            const intel = (_b = Memory.mapIntel) === null || _b === void 0 ? void 0 : _b[roomName];
            if ((intel === null || intel === void 0 ? void 0 : intel.unsafe) || (intel === null || intel === void 0 ? void 0 : intel.scoutedAt)) {
                continue;
            }
            needScout = true;
            break;
        }
        if (!needScout) {
            return;
        }
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (creep.memory.spawnRoom === this.name && creep.memory.role === 'viewer') {
                return;
            }
        }
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask');
        for (const key in spawnBuckets) {
            for (const task of (_c = spawnBuckets[key]) !== null && _c !== void 0 ? _c : []) {
                if (((_d = task === null || task === void 0 ? void 0 : task.taskParam) === null || _d === void 0 ? void 0 : _d[0]) === 'viewer') {
                    return;
                }
            }
        }
        this.addToSpawnList('viewer');
    }
    /**
     * 按富余能量门槛孵化外矿 harvester。
     * 外矿角色不进 initSpawn 的配额（reSpawn=false），补员完全由这里决定，
     * 所以随时可以关掉，不会和主房抢 spawn。
     */
    refreshRemoteSpawn() {
        var _a;
        if (!this.memory.creepTask || !this.controller) {
            return;
        }
        const plan = (_a = Memory.remotePlan) === null || _a === void 0 ? void 0 : _a[this.name];
        if (!plan || plan.enabled === false) {
            return;
        }
        this.refreshRemoteHarvesterSpawn(plan);
        this.refreshRemoteCarrierSpawn(plan);
    }
    /**
     * 按每个外矿矿点补 remoteHarvester。
     */
    refreshRemoteHarvesterSpawn(plan) {
        var _a, _b, _c;
        let want = 0;
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName];
            if (!state || state.enabled === false) {
                continue;
            }
            // 还没情报的房交给侦察兵，不在这里派 harvester
            want += Object.keys((_a = state.sources) !== null && _a !== void 0 ? _a : {}).length;
        }
        if (!want) {
            return;
        }
        let alive = 0;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory.spawnRoom === this.name && creep.memory.role === 'remoteHarvester') {
                alive += 1;
            }
        }
        let queued = 0;
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask');
        for (const key in spawnBuckets) {
            for (const task of (_b = spawnBuckets[key]) !== null && _b !== void 0 ? _b : []) {
                if (((_c = task === null || task === void 0 ? void 0 : task.taskParam) === null || _c === void 0 ? void 0 : _c[0]) === 'remoteHarvester') {
                    queued += 1;
                }
            }
        }
        if (alive + queued >= want) {
            return;
        }
        if (!plan.force && !this.remoteGate()) {
            return;
        }
        for (let i = alive + queued; i < want; i++) {
            this.addToSpawnList('remoteHarvester');
        }
    }
    /**
     * 每个"已建好 container"的启用外矿房补一个专用 remoteCarrier。
     * 专用角色只认 remoteCarryTask，不会被本地 carryTask 长期饿死。
     */
    refreshRemoteCarrierSpawn(plan) {
        var _a, _b;
        let want = 0;
        for (const roomName in plan.rooms) {
            const state = plan.rooms[roomName];
            if (!state || state.enabled === false) {
                continue;
            }
            const sources = state.sources;
            if (!sources) {
                continue;
            }
            // container 建好才派运输，否则 carrier 去了也没东西可拉
            const hasContainer = Object.keys(sources).some(sourceId => { var _a; return !!((_a = sources[sourceId]) === null || _a === void 0 ? void 0 : _a.containerId); });
            if (hasContainer) {
                want += remoteSetting.carriersPerRoom;
            }
        }
        if (!want) {
            return;
        }
        let alive = 0;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory.spawnRoom === this.name && creep.memory.role === 'remoteCarrier') {
                alive += 1;
            }
        }
        let queued = 0;
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask');
        for (const key in spawnBuckets) {
            for (const task of (_a = spawnBuckets[key]) !== null && _a !== void 0 ? _a : []) {
                if (((_b = task === null || task === void 0 ? void 0 : task.taskParam) === null || _b === void 0 ? void 0 : _b[0]) === 'remoteCarrier') {
                    queued += 1;
                }
            }
        }
        if (alive + queued >= want) {
            return;
        }
        if (!plan.force && !this.remoteGate()) {
            return;
        }
        for (let i = alive + queued; i < want; i++) {
            this.addToSpawnList('remoteCarrier');
        }
    }
    /**
     * 富余能量门槛：主房没有待孵化任务、能量结构满、本地 container 超过高水位。
     * 三条同时满足才认为"有多余能量"，可以拿去养外矿。
     */
    remoteGate() {
        var _a, _b;
        if (!this.controller) {
            return false;
        }
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask');
        for (const key in spawnBuckets) {
            if (Number(key) < 3 && ((_a = spawnBuckets[key]) !== null && _a !== void 0 ? _a : []).length) {
                return false;
            }
        }
        if (this.energyAvailable < this.energyCapacityAvailable) {
            return false;
        }
        const level = this.controller.level;
        const watermark = (_b = containerWatermark[level]) !== null && _b !== void 0 ? _b : containerWatermark[0];
        for (const id of this.getContainer()) {
            const container = Game.getObjectById(id);
            if (container && container.store.getUsedCapacity(RESOURCE_ENERGY) >= watermark.high) {
                return true;
            }
        }
        return false;
    }
    /**
     * 取能量最多的 container（高于低水位才可取）。
     * 给 carryTask 自带取能用：carrier 保持 priority 1 的补能任务，
     * 不需要降级成 emptyWorker 去和 worker 抢通用 energyTask。
     */
    bestEnergyContainer() {
        var _a;
        const level = this.controller ? this.controller.level : 0;
        const low = ((_a = containerWatermark[level]) !== null && _a !== void 0 ? _a : containerWatermark[0]).low;
        let best;
        let bestEnergy = low;
        for (const id of this.getContainer()) {
            const container = Game.getObjectById(id);
            if (!container) {
                continue;
            }
            const energy = container.store.getUsedCapacity(RESOURCE_ENERGY);
            if (energy > bestEnergy) {
                best = container;
                bestEnergy = energy;
            }
        }
        return best;
    }
    /**
     * 有视野时把外矿矿点/container 的最新情况写回顶层缓存。
     */
    updateRemoteCache(state, remoteRoom) {
        if (!state.sources) {
            state.sources = {};
        }
        const sources = remoteRoom.find(FIND_SOURCES);
        for (const source of sources) {
            let entry = state.sources[source.id];
            if (!entry) {
                entry = state.sources[source.id] = {};
            }
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (object) => object.structureType === STRUCTURE_CONTAINER
            });
            if (containers.length) {
                entry.containerId = containers[0].id;
                entry.containerPos = [containers[0].pos.x, containers[0].pos.y];
                continue;
            }
            const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
                filter: (object) => object.structureType === STRUCTURE_CONTAINER
            });
            if (sites.length) {
                entry.containerPos = [sites[0].pos.x, sites[0].pos.y];
            }
        }
        for (const sourceId in state.sources) {
            if (!sources.some(source => source.id === sourceId)) {
                delete state.sources[sourceId];
            }
        }
        // 顺带刷新情报：有主/被他人 reserve/有敌对时会把该外矿房停用
        recordRoomIntel(this.name, remoteRoom);
    }
    /**
     * 主房接收外矿能量的目标：storage 优先，没有 storage 就选空位最多的 container，
     * 再没有 container 就补给 spawn/extension。
     */
    remoteEnergySink() {
        if (this.storage && this.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            return this.storage.id;
        }
        let best;
        let bestFree = 0;
        for (const id of this.getContainer()) {
            const container = Game.getObjectById(id);
            if (!container) {
                continue;
            }
            const free = container.store.getFreeCapacity(RESOURCE_ENERGY);
            if (free > bestFree) {
                best = id;
                bestFree = free;
            }
        }
        if (best) {
            return best;
        }
        for (const id of this.energyStructureOrder()) {
            const structure = Game.getObjectById(id);
            if (structure && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                return structure.id;
            }
        }
        return undefined;
    }
    /**
     * 按 targetId 同步一个外矿任务桶：更新并发、清掉失效任务、补缺。
     * 没有视野时不删任务（此时 getObjectById 查不到不代表目标没了）。
     */
    syncRemoteBucket(taskType, desired) {
        var _a, _b, _c, _d, _e, _f, _g;
        const buckets = this.normalizeTaskBuckets(taskType);
        const desiredById = {};
        for (const task of desired) {
            const targetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
            if (targetId) {
                desiredById[targetId] = task;
            }
        }
        const existing = new Set();
        for (const key in buckets) {
            const bucket = buckets[key];
            if (!bucket || !bucket.length) {
                delete buckets[key];
                continue;
            }
            const next = [];
            for (const task of bucket) {
                if (!task) {
                    continue;
                }
                const targetId = (_c = task.targetId) !== null && _c !== void 0 ? _c : (_d = task.taskParam) === null || _d === void 0 ? void 0 : _d[0];
                if (!targetId) {
                    continue;
                }
                const roomName = (_e = task.taskParam) === null || _e === void 0 ? void 0 : _e[1];
                const hasVision = !roomName || !!Game.rooms[roomName];
                const wanted = desiredById[targetId];
                if (!wanted) {
                    if (!hasVision) {
                        next.push(task);
                    }
                    continue;
                }
                const realId = (_f = task.taskParam) === null || _f === void 0 ? void 0 : _f[0];
                if (hasVision && realId && !Game.getObjectById(realId)) {
                    continue;
                }
                task.capacity = (_g = wanted.capacity) !== null && _g !== void 0 ? _g : task.capacity;
                next.push(task);
                existing.add(targetId);
            }
            if (next.length) {
                buckets[key] = next;
            }
            else {
                delete buckets[key];
            }
        }
        const toAdd = desired.filter(task => {
            var _a, _b;
            const targetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
            return !!targetId && !existing.has(targetId);
        });
        if (toAdd.length) {
            this.registTask(toAdd);
        }
    }
    /**
     * 推代码后队列重建、task 的 reservedBy 是空的，但老 creep 的 currentWork 还在。
     * 不把已经在采这个矿的 harvester 补进预约，就会再派一个去同一个矿。
     */
    seedRemoteHarvestReservations() {
        var _a, _b, _c, _d;
        const buckets = this.normalizeTaskBuckets('remoteHarvestTask');
        const assigned = {};
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory.spawnRoom !== this.name
                || creep.memory.role !== 'remoteHarvester'
                || !creep.memory.harvestSourceId) {
                continue;
            }
            const sourceId = creep.memory.harvestSourceId;
            const list = (_a = assigned[sourceId]) !== null && _a !== void 0 ? _a : (assigned[sourceId] = []);
            list.push(name);
        }
        for (const key in buckets) {
            for (const task of (_b = buckets[key]) !== null && _b !== void 0 ? _b : []) {
                if (!task) {
                    continue;
                }
                const sourceId = (_c = task.taskParam) === null || _c === void 0 ? void 0 : _c[0];
                if (!sourceId) {
                    continue;
                }
                const names = assigned[sourceId];
                if (!names || !names.length) {
                    continue;
                }
                task.reservedBy = (_d = task.reservedBy) !== null && _d !== void 0 ? _d : [];
                for (const name of names) {
                    if (!task.reservedBy.some(item => (item === null || item === void 0 ? void 0 : item.name) === name)) {
                        task.reservedBy.push({ name, lastTick: Game.time });
                    }
                }
            }
        }
    }
    /**
     * 取能目标当前可用能量：container/storage/tombstone 读 store，掉落物读 amount。
     */
    energyOf(target) {
        var _a, _b;
        if (target.store && typeof target.store.getUsedCapacity == 'function') {
            return (_a = target.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 0;
        }
        if (target.resourceType === RESOURCE_ENERGY || target.resourceType === undefined) {
            return (_b = target.amount) !== null && _b !== void 0 ? _b : 0;
        }
        return 0;
    }
    addExtensionCarryTasks(structureIds) {
        var _a, _b;
        if (!this.memory.creepTask) {
            return;
        }
        const carryBuckets = this.normalizeTaskBuckets('carryTask');
        const existingIds = new Set();
        for (const key in carryBuckets) {
            const bucket = carryBuckets[key];
            if (!bucket || !bucket.length) {
                continue;
            }
            for (const task of bucket) {
                if (!task) {
                    continue;
                }
                const taskTargetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
                if (taskTargetId) {
                    existingIds.add(taskTargetId);
                }
            }
        }
        const toAdd = [];
        for (const id of structureIds) {
            const structure = Game.getObjectById(id);
            if (!structure) {
                continue;
            }
            if (!structure.store.getFreeCapacity(RESOURCE_ENERGY)) {
                continue;
            }
            if (existingIds.has(structure.id)) {
                continue;
            }
            toAdd.push(structure);
        }
        if (toAdd.length) {
            this.registTask(getCarryList(toAdd, RESOURCE_ENERGY));
        }
    }
    /**
     * 为单个结构登记补能任务（塔等主动请求补能用）。
     * 已经存在指向该结构的 carryTask 时不重复登记。
     */
    ensureEnergyCarryTask(structureId) {
        var _a, _b;
        if (!this.memory.creepTask) {
            return;
        }
        const structure = Game.getObjectById(structureId);
        if (!structure || !structure.store.getFreeCapacity(RESOURCE_ENERGY)) {
            return;
        }
        const carryBuckets = this.normalizeTaskBuckets('carryTask');
        for (const key in carryBuckets) {
            const bucket = carryBuckets[key];
            if (!bucket || !bucket.length) {
                continue;
            }
            for (const task of bucket) {
                if (!task) {
                    continue;
                }
                const taskTargetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
                if (taskTargetId === structureId) {
                    return;
                }
            }
        }
        this.registTask(getCarryList([structure], RESOURCE_ENERGY));
    }
    /**
     * 把扫描缓存里的维修队列同步成 worker 任务。
     * 由 scan() 每 repairScanInterval tick 调用一次。
     */
    syncRepairTasks() {
        const cache = global.room[this.name];
        if (!cache || !cache.repairQueue) {
            return;
        }
        this.syncTaskQueue('repairTask', cache.repairQueue, repairSetting.maxTasks, getRepairTasks);
    }
    /**
     * 同步墙体/防御墙维护任务，数量受 wallSetting.maxTasks 限制。
     */
    syncWallRepairTasks() {
        var _a;
        const cache = global.room[this.name];
        if (!cache || !cache.maintenanceQueue || !this.controller) {
            return;
        }
        const targetHits = (_a = wallSetting.targetHits[this.controller.level]) !== null && _a !== void 0 ? _a : 0;
        if (!targetHits) {
            return;
        }
        this.syncTaskQueue('wallRepairTask', cache.maintenanceQueue, wallSetting.maxTasks, targets => getWallRepairTasks(targets, targetHits));
    }
    /**
     * 通用任务同步：清理失效任务，再从队列头部补足到 maxTasks。
     * 已经有人领取的任务保留，等 worker 自己释放。
     */
    syncTaskQueue(taskType, sourceIds, maxTasks, factory) {
        var _a, _b, _c;
        if (!this.memory.creepTask || !this.controller || !this.controller.my) {
            return;
        }
        const buckets = this.normalizeTaskBuckets(taskType);
        const knownTargets = new Set();
        for (const key in buckets) {
            const queue = buckets[key];
            if (!queue || !queue.length) {
                delete buckets[key];
                continue;
            }
            const next = [];
            for (const task of queue) {
                if (!task) {
                    continue;
                }
                const targetId = (_a = task.targetId) !== null && _a !== void 0 ? _a : (_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0];
                const target = targetId ? Game.getObjectById(targetId) : null;
                const reserved = !!(task.reservedBy && task.reservedBy.length);
                // 目标血量可能是任务参数里的维护目标（墙/rampart），没有则修到 hitsMax
                const goalHits = target
                    ? (typeof ((_c = task.taskParam) === null || _c === void 0 ? void 0 : _c[1]) === 'number' ? task.taskParam[1] : target.hitsMax)
                    : 0;
                // 已经修好/消失且没人在修的任务直接删掉；有人在修的等 worker 自己释放
                if ((!target || target.hits >= goalHits) && !reserved) {
                    continue;
                }
                if (targetId) {
                    knownTargets.add(targetId);
                }
                next.push(task);
            }
            if (next.length) {
                buckets[key] = next;
            }
            else {
                delete buckets[key];
            }
        }
        let taskCount = knownTargets.size;
        if (taskCount >= maxTasks) {
            return;
        }
        const toAdd = [];
        for (const id of sourceIds) {
            if (taskCount + toAdd.length >= maxTasks) {
                break;
            }
            if (knownTargets.has(id)) {
                continue;
            }
            const structure = Game.getObjectById(id);
            if (!structure) {
                continue;
            }
            toAdd.push(structure);
        }
        if (toAdd.length) {
            this.registTask(factory(toAdd));
        }
    }
    /**
     * 临时函数
     */
    initSpawnList() {
        for (let i = 0; i < 2; i++) {
            this.addToSpawnList('harvester');
            this.addToSpawnList('worker');
        }
    }
    /**
     * Spawn相关
     */
    initSpawn(level) {
        var _a, _b, _c, _d;
        console.log("Global init Spawn");
        let spawnNum = {
            'harvester': this.find(FIND_SOURCES).length,
            'carrier': spawnTable['carrier'][level],
            'worker': spawnTable['worker'][level],
            'emptyWorker': spawnTable['emptyWorker'][level],
            // 外矿 harvester 不参与自动补员：配额故意为 0，让它 reSpawn=false，
            // 由 refreshRemoteSpawn 按"富余能量"门槛决定要不要孵化
            'remoteHarvester': 0,
            // 外矿运输同理，由 refreshRemoteCarrierSpawn 按每个外矿房的 container 补员
            'remoteCarrier': 0,
            // 侦察兵同样不参与自动补员，由 refreshScoutSpawn 按需补
            'viewer': 0,
        };
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            // console.log(creepName, creep, creep.memory.spawnRoom)
            if (creep.memory.spawnRoom == this.name) {
                // console.log(1)
                // remember() 会重建 Memory.creeps 条目，先保住 harvester 绑定的矿点，
                // 否则每次推送代码都会丢掉矿点归属，补员/换班就会数错人数
                const assignedSource = (_a = creep.memory.harvestSourceId) !== null && _a !== void 0 ? _a : (_c = (_b = creep.memory.currentWork) === null || _b === void 0 ? void 0 : _b.taskParam) === null || _c === void 0 ? void 0 : _c[0];
                // remember() 会用 creep 当前所在房间重建 spawnRoom，并丢掉 currentWork。
                // 跨房执行外矿任务时两者都不能丢：spawnRoom 丢了会让补员/回收认错房间，
                // currentWork 丢了会让 creep 在外矿/路上没法从主房队列重新领任务。
                const outsideHome = creep.room.name !== this.name;
                const savedWork = outsideHome ? creep.memory.currentWork : undefined;
                const savedWorkType = outsideHome ? creep.memory.currentWorkType : undefined;
                delete Memory.creeps[creepName];
                creep.remember();
                creep.memory.spawnRoom = this.name;
                if (savedWork) {
                    creep.memory.currentWork = savedWork;
                    creep.memory.currentWorkType = savedWorkType;
                    creep.memory.working = true;
                }
                // 推代码会清空所有事件；外矿 creep 不在主房，initCreepRecycle 扫不到，
                // 这里补一个回收事件，保证死亡后能清内存/按 reSpawn 补员
                if (outsideHome && creep.ticksToLive !== undefined) {
                    this.registEvent({
                        triggerTime: Game.time + creep.ticksToLive + 1,
                        triggerFunc: 'creepRecycle',
                        param: []
                    });
                }
                // emptyWorker 只是临时取能状态，按原职业统计，否则每次推送代码都会
                // 把正在取能的 worker 当成缺失，重复排队孵化
                const role = creep.memory.role === 'emptyWorker'
                    ? ((_d = creep.memory.oldRole) !== null && _d !== void 0 ? _d : creep.memory.role)
                    : creep.memory.role;
                // 代码推送会清空 Memory.rooms（包括事件），这里给现存的 harvester 重新挂换班事件
                if (role === 'harvester') {
                    if (assignedSource) {
                        creep.memory.harvestSourceId = assignedSource;
                    }
                    this.scheduleHarvesterHandover(creep);
                }
                // 还需要孵化, 那就直接拿现成的, 把任务扔掉就行
                if (spawnNum[role]) {
                    spawnNum[role] -= 1;
                    creep.memory.reSpawn = true;
                }
                else {
                    // 不需要孵化了
                    creep.memory.reSpawn = false;
                }
            }
        }
        for (const role in spawnNum) {
            for (let i = 0; i < spawnNum[role]; i++) {
                this.addToSpawnList(role);
            }
        }
    }
    addToSpawnList(role, sourceId) {
        if (!this.memory.creepTask) {
            return;
        }
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask');
        if (!spawnBuckets) {
            return;
        }
        const task = {
            id: `spawn-${role}-${Game.time}-${Math.random().toString(36).slice(2)}`,
            taskFunc: "spawnCreep",
            // 第三、四个参数：矿点 id（提前换班的 harvester 只认这个矿点）、
            // reSpawn 标记（false 表示死亡后由外矿逻辑补员，creepRecycle 不无条件重孵）
            taskParam: [role, getBody(role, this), sourceId, role !== 'remoteCarrier'],
            // 记录排队时间：spawn 等能量超过阈值后会按当前能量缩小体型兜底，
            // 避免 carrier 全灭时 priority 0 的大体型任务把整队堵死
            queuedAt: Game.time,
            // 记录排队时的能量高水位：能量还在增长就说明房间在回血，先不缩体型
            queuedEnergy: this.energyAvailable,
            createdAt: Game.time,
            // 外矿/侦察兵排在最后：本地换班/补员都做完了才轮得到它们
            priority: role == 'harvester' ? 0
                : role == 'carrier' ? 1
                    : role == 'viewer' ? 4
                        : role == 'remoteHarvester' ? 3
                            : role == 'remoteCarrier' ? 3
                                : 2,
            capacity: 1,
            persistent: false,
            reservedBy: []
        };
        const key = String(task.priority);
        if (!spawnBuckets[key]) {
            spawnBuckets[key] = [];
        }
        spawnBuckets[key].push(task);
    }
    /**
     * 给 harvester 挂一个换班事件：TTL 降到「孵化 + 赶路 + 余量」门槛时触发一次。
     * 这样不需要定期扫描所有 creep，每个 harvester 一生只触发一次。
     */
    scheduleHarvesterHandover(creep) {
        const ticksToLive = creep.ticksToLive;
        if (ticksToLive === undefined) {
            return;
        }
        const threshold = this.harvesterHandoverThreshold(creep);
        const countdown = Math.max(1, ticksToLive - threshold);
        this.registEvent({
            triggerTime: Game.time + countdown,
            triggerFunc: 'harvesterHandover',
            param: [creep.name]
        });
    }
    /**
     * 换班事件：creep 快死了，确保它负责的矿点有替补。
     * 只看这一个矿点，不做全局扫描。
     */
    harvesterHandover(creepName) {
        const creep = Game.creeps[creepName];
        if (!creep) {
            // creep 已经死了，由 creepRecycle 兜底补员
            return;
        }
        const sourceId = this.harvesterSourceOf(creep);
        if (!sourceId) {
            return;
        }
        if (!this.ensureHarvesterForSource(sourceId)) {
            // 暂时没法处理（比如还没有 spawn），稍后重试
            this.registEvent({
                triggerTime: Game.time + 20,
                triggerFunc: 'harvesterHandover',
                param: [creepName]
            });
        }
    }
    /**
     * 确保某个矿点有健康的 harvester：有就清掉多余替补，没有就排一个指定矿点的替补。
     * @returns false 表示当前无法处理（房间没有 spawn 等）
     */
    ensureHarvesterForSource(sourceId) {
        var _a, _b, _c;
        if (!this.controller || !this.controller.my || !this.memory.creepTask) {
            return true;
        }
        if (!this.find(FIND_MY_SPAWNS).length) {
            return false;
        }
        const distances = (_a = this.memory.harvestSpawnDistance) !== null && _a !== void 0 ? _a : {};
        const body = getBody('harvester', this);
        const spawnTicks = calcSpawnTicks(body);
        const ticksPerTile = calcTicksPerTile(body);
        const thresholdOf = (creep) => {
            const distance = distances[sourceId] || this.maxHarvestDistance(distances);
            return spawnTicks + distance * ticksPerTile + harvestSetting.earlyMargin;
        };
        const isHealthy = (creep) => creep.ticksToLive === undefined || creep.ticksToLive > thresholdOf();
        // 该矿点任务上的预约
        const reservers = [];
        const buckets = this.normalizeTaskBuckets('harvestTask');
        for (const key in buckets) {
            const queue = buckets[key];
            if (!queue || !queue.length) {
                continue;
            }
            for (const task of queue) {
                if (!task || ((_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[0]) !== sourceId) {
                    continue;
                }
                for (const item of (_c = task.reservedBy) !== null && _c !== void 0 ? _c : []) {
                    const creep = item && Game.creeps[item.name];
                    if (creep) {
                        reservers.push(creep);
                    }
                }
            }
        }
        // 代码推送后预约可能被清空，但 creep 内存里还记着矿点，仍算有效覆盖
        const miners = this.find(FIND_MY_CREEPS).filter(creep => creep.memory.role === 'harvester' && this.harvesterSourceOf(creep) === sourceId);
        const covered = reservers.concat(miners).some(creep => isHealthy(creep));
        if (covered) {
            this.cancelHarvestSpawnTasks(sourceId);
            return true;
        }
        if (this.hasHarvesterPending(sourceId)) {
            return true;
        }
        this.addToSpawnList('harvester', sourceId);
        return true;
    }
    /**
     * 该矿点是否已经有在排队/孵化中的 harvester（包括没指定矿点的通用补员）
     */
    hasHarvesterPending(sourceId) {
        var _a, _b, _c, _d;
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask');
        for (const key in spawnBuckets) {
            const queue = spawnBuckets[key];
            if (!queue || !queue.length) {
                continue;
            }
            for (const task of queue) {
                if (task && ((_a = task.taskParam) === null || _a === void 0 ? void 0 : _a[0]) === 'harvester'
                    && (((_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[2]) === sourceId || !((_c = task.taskParam) === null || _c === void 0 ? void 0 : _c[2]))) {
                    return true;
                }
            }
        }
        for (const spawn of this.find(FIND_MY_SPAWNS)) {
            const spawningName = (_d = spawn.spawning) === null || _d === void 0 ? void 0 : _d.name;
            const spawningMemory = spawningName ? Memory.creeps[spawningName] : undefined;
            if (spawningMemory && spawningMemory.role === 'harvester'
                && (spawningMemory.harvestSourceId === sourceId || !spawningMemory.harvestSourceId)) {
                return true;
            }
        }
        return false;
    }
    /**
     * 移除指定矿点多余的 harvester 替补 spawn 任务
     */
    cancelHarvestSpawnTasks(sourceId) {
        const spawnBuckets = this.normalizeTaskBuckets('spawnTask');
        for (const key in spawnBuckets) {
            const queue = spawnBuckets[key];
            if (!queue || !queue.length) {
                continue;
            }
            const next = queue.filter(task => { var _a, _b; return !(task && ((_a = task.taskParam) === null || _a === void 0 ? void 0 : _a[0]) === 'harvester' && ((_b = task.taskParam) === null || _b === void 0 ? void 0 : _b[2]) === sourceId); });
            if (next.length) {
                spawnBuckets[key] = next;
            }
            else {
                delete spawnBuckets[key];
            }
        }
    }
    harvesterSourceOf(creep) {
        var _a, _b, _c;
        return ((_a = creep.memory.harvestSourceId) !== null && _a !== void 0 ? _a : (_c = (_b = creep.memory.currentWork) === null || _b === void 0 ? void 0 : _b.taskParam) === null || _c === void 0 ? void 0 : _c[0]);
    }
    harvesterHandoverThreshold(creep) {
        var _a;
        const body = getBody('harvester', this);
        const distances = (_a = this.memory.harvestSpawnDistance) !== null && _a !== void 0 ? _a : {};
        const sourceId = this.harvesterSourceOf(creep);
        const distance = (sourceId && distances[sourceId]) || this.maxHarvestDistance(distances);
        return calcSpawnTicks(body) + distance * calcTicksPerTile(body) + harvestSetting.earlyMargin;
    }
    maxHarvestDistance(distances) {
        let max = 0;
        for (const sourceId in distances) {
            if (distances[sourceId] > max) {
                max = distances[sourceId];
            }
        }
        return max || harvestSetting.defaultDistance;
    }
    creepRecycle() {
        var _a, _b, _c;
        const currentTimestamp = Game.time;
        // 检查上次调用时间
        const lastRecycleTimestamp = global.lastRecycleTime;
        if (currentTimestamp === lastRecycleTimestamp) {
            // 如果当前时间与上次调用时间相同，说明已经在本 tick 内调用过 recycle 函数，直接返回
            return;
        }
        for (let creepName in Memory.creeps) {
            if (!Game.creeps[creepName]) {
                // creep 已经死了
                const memory = Memory.creeps[creepName];
                const room = Game.rooms[memory.spawnRoom];
                // 从房间所有任务队列里清除该 creep 的预约（persistent 任务同样要清）
                if (room && room.memory.creepTask) {
                    for (const taskType in room.memory.creepTask) {
                        const buckets = room.memory.creepTask[taskType];
                        if (!buckets) {
                            continue;
                        }
                        for (const key in buckets) {
                            const queue = buckets[key];
                            if (!queue || !queue.length) {
                                continue;
                            }
                            for (const task of queue) {
                                if (task && task.reservedBy) {
                                    task.reservedBy = task.reservedBy.filter(item => item.name !== creepName);
                                }
                            }
                        }
                    }
                }
                if (room && memory.spawnRoom && memory.reSpawn) {
                    if (memory.oldRole) {
                        memory.role = memory.oldRole;
                    }
                    if (memory.role === 'harvester') {
                        // harvester 正常由换班事件提前替补；意外死亡时在这里兜底补员
                        const sourceId = ((_a = memory.harvestSourceId) !== null && _a !== void 0 ? _a : (_c = (_b = memory.currentWork) === null || _b === void 0 ? void 0 : _b.taskParam) === null || _c === void 0 ? void 0 : _c[0]);
                        if (sourceId) {
                            room.ensureHarvesterForSource(sourceId);
                        }
                    }
                    else {
                        room.addToSpawnList(memory.role);
                    }
                }
                delete Memory.creeps[creepName];
            }
        }
        global.lastRecycleTime = currentTimestamp;
    }
    /**
     * event相关
     * @param event
     */
    registEvent(event) {
        if (!this.memory.timer) {
            this.memory.timer = {};
        }
        if (!this.memory.timer[event.triggerTime]) {
            this.memory.timer[event.triggerTime] = [];
        }
        this.memory.timer[event.triggerTime].push([event.triggerFunc, event.param]);
    }
    runEvent() {
        if (!this.memory.timer) {
            this.memory.timer = {};
            return;
        }
        while (this.memory.timer[Game.time] && this.memory.timer[Game.time].length) {
            const [func, param] = this.memory.timer[Game.time].pop();
            // console.log(func)
            this[func](...param);
        }
        delete this.memory.timer[Game.time];
    }
    calSpawningTime(SpawnId) {
        const thisSpawn = Game.getObjectById(SpawnId);
        if (!thisSpawn || !thisSpawn.spawning) {
            return;
        }
        // spawn 消耗产生的补能需求由 refillAfterSpawn 在 +1 tick 登记，
        // 这里只负责在孵化完成后安排 recycle 事件
        this.registEvent({
            triggerTime: Game.time + thisSpawn.spawning.remainingTime + 1,
            triggerFunc: "calRecycleTime",
            param: [thisSpawn.spawning.name]
        });
    }
    calRecycleTime(creepName) {
        const creep = Game.creeps[creepName];
        if (!creep) {
            return;
        }
        this.registEvent({
            triggerTime: Game.time + creep.ticksToLive + 1,
            triggerFunc: "creepRecycle",
            param: []
        });
        // 孵化完成时给 harvester 挂换班事件，到期只检查它自己的矿点
        if (creep.memory.role === 'harvester') {
            this.scheduleHarvesterHandover(creep);
        }
    }
    buildOver(x, y) {
        const structures = this.lookForAt(LOOK_STRUCTURES, x, y);
        for (const structure of structures) {
            if (structure.onBuild) {
                structure.onBuild();
            }
            // 新建的 spawn/extension 加入能量结构顺序表，后续 spawn 就能直接用它
            if (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) {
                this.registerEnergyStructure(structure.id);
            }
            // 新建 container 立即刷新容器列表，不用等 100 tick 兜底
            if (structure.structureType === STRUCTURE_CONTAINER) {
                this.refreshContainers();
            }
        }
    }
    checkRoomLevel() {
        if (!global.room[this.name]) {
            global.room[this.name] = {};
        }
        if (this.memory.roomType) {
            return;
        }
        if (global.room[this.name].controllerProgress === undefined) {
            global.room[this.name].controllerProgress = this.controller.progress;
            this.registEvent(checkRoomLevelEvent(Game.time + 1));
            return;
        }
        const lastProgress = global.room[this.name].controllerProgress;
        const currentProgress = this.controller.progress;
        global.room[this.name].controllerProgress = currentProgress;
        const diff = currentProgress - lastProgress;
        const progressTotal = this.controller.progressTotal;
        const remain = progressTotal - currentProgress;
        this.initBuildList();
        if (this.controller.level == 8) {
            this.registEvent(checkRoomLevelEvent(Game.time + this.controller.ticksToDowngrade + 1));
            return;
        }
        // progress 在升级时会归零重算，所以 diff < 0 就是刚刚升级的信号。
        // 此时 initBuildList 已经用新等级重建了工地；这里再按新等级的
        // spawnTable 重算孵化配额，并让升级并发跟着新工地回落。
        // 下一 tick 先重新测量新等级的升级速度，再进入正常排期。
        if (diff < 0) {
            if (this.memory.creepTask) {
                // initSpawn 只按存活 creep 算差额、不统计已排队未孵化的任务，
                // 先清空避免重复排队（与 globalReset 的做法一致）
                this.memory.creepTask.spawnTask = {};
            }
            this.initSpawn(this.controller.level);
            this.refreshUpgradeTask();
            this.registEvent(checkRoomLevelEvent(Game.time + 1));
            return;
        }
        // 预测间隔除以 3：提前触发会用新测到的 diff 重新预测，
        // 升级速度变化时最多 1/3 个旧预估就能纠正，避免一次排到几百 tick 后。
        let tickGap;
        if (diff === 0) {
            if (remain < 1000) {
                // 进度停滞后恢复，按 1 progress/tick 的保守值每 1/5 检查一次
                tickGap = Math.ceil(remain / 5) + 1;
            }
            else {
                tickGap = Math.max(10, Math.ceil(remain / 300));
            }
        }
        else {
            // 最低 10 tick，避免接近升级时极限情况下每 tick 都跑一遍 initBuildList
            tickGap = Math.max(10, Math.ceil(remain / diff / 3));
        }
        this.registEvent(checkRoomLevelEvent(Game.time + tickGap));
    }
    hello() {
        loggerInstance.debug("hello world");
    }
    /**
     * task相关
     */
    initTask(level) {
        this.registTask(harvestSource(this));
        this.registTask(upgrade(this));
    }
    /**
     * 注册任务, 支持同时注册多个
     * @param tasks
     */
    registTask(tasks) {
        var _a, _b, _c, _d;
        for (const task of tasks) {
            const bucketKey = String((_a = task.priority) !== null && _a !== void 0 ? _a : 2);
            const buckets = this.normalizeTaskBuckets(task.taskType);
            if (!buckets[bucketKey]) {
                buckets[bucketKey] = [];
            }
            buckets[bucketKey].push({
                id: `${task.taskFunc}-${Game.time}-${Math.random().toString(36).slice(2)}`,
                taskFunc: task.taskFunc,
                taskParam: task.taskParam,
                priority: (_b = task.priority) !== null && _b !== void 0 ? _b : 2,
                capacity: (_c = task.capacity) !== null && _c !== void 0 ? _c : 1,
                persistent: (_d = task.persistent) !== null && _d !== void 0 ? _d : false,
                targetId: task.targetId,
                reservedBy: []
            });
            this.memory.creepTask[task.taskType] = buckets;
        }
        // console.log()
    }
    /**
     * 房间缓存
     */
    calSourceMap() {
        function outOfMap(x, y) {
            return x < 0 || x > 49 || x < 0 || y > 49;
        }
        if (!global.room[this.name].terrainMap) {
            this.loadTerrain();
        }
        const terrainMap = global.room[this.name].terrainMap;
        const containerPoses = this.containerPos();
        let map = initializeArray(50, 50);
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];
        for (let i = 0; i < 50; i++) {
            for (let j = 0; j < 50; j++) {
                map[i][j] = -1;
            }
        }
        let queue = [];
        for (let i in containerPoses) {
            queue.push(containerPoses[i]);
            map[containerPoses[i][0]][containerPoses[i][1]] = i;
        }
        while (queue.length > 0) {
            const [xx, yy] = queue.shift();
            const value = map[xx][yy];
            for (let direction of directions) {
                let x = xx + direction[0];
                let y = yy + direction[1];
                if (!outOfMap(x, y) && map[x][y] == -1 && terrainMap[x][y]) {
                    map[x][y] = value;
                    queue.push([x, y]);
                }
            }
        }
        this.visualizeMap(map);
    }
    getResources() {
        if ((Game.time % 10 === 1)) {
            let resources = this.find(FIND_DROPPED_RESOURCES);
            global.room[this.name].resources = resources;
        }
        return global.room[this.name].resources;
    }
    /**
     * 容器 id 列表。以前取到一次就永久缓存，新 container 建成后永远进不来；
     * 现在按 containerScanInterval 兜底刷新，建成时由 buildOver 立即刷新。
     */
    getContainer() {
        if (!global.room[this.name]) {
            global.room[this.name] = {};
        }
        if (!global.room[this.name].container) {
            return this.refreshContainers();
        }
        return global.room[this.name].container;
    }
    refreshContainers() {
        var _a;
        if (!global.room[this.name]) {
            global.room[this.name] = {};
        }
        const containers = [];
        const posList = (_a = this.containerPos()) !== null && _a !== void 0 ? _a : [];
        for (const [x, y] of posList) {
            const pos = this.getPositionAt(x, y);
            if (!pos) {
                continue;
            }
            const structure = pos.lookFor(LOOK_STRUCTURES)
                .find(item => item.structureType === STRUCTURE_CONTAINER);
            if (structure) {
                containers.push(structure.id);
            }
        }
        global.room[this.name].container = containers;
        global.room[this.name].lastContainerScan = Game.time;
        return containers;
    }
    /**
     * 存活 carrier 的平均载重。取能任务的并发数按它算：
     * carrier 越大，同一个 container 需要的人越少。
     * 同 tick 内只算一次。
     */
    avgCarrierCapacity() {
        if (!global.room[this.name]) {
            global.room[this.name] = {};
        }
        const cache = global.room[this.name];
        if (cache.avgCarrierCapacityTick === Game.time && cache.avgCarrierCapacity !== undefined) {
            return cache.avgCarrierCapacity;
        }
        let total = 0;
        let count = 0;
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            if (creep.memory.role !== 'carrier') {
                continue;
            }
            const capacity = creep.store.getCapacity();
            if (capacity) {
                total += capacity;
                count += 1;
            }
        }
        let average = count ? total / count : 0;
        if (!average) {
            // 还没孵化过 carrier 时按计划 body 兜底
            const carryParts = getBody('carrier', this).filter(part => part === CARRY).length;
            average = Math.max(carryParts * 50, 50);
        }
        cache.avgCarrierCapacity = average;
        cache.avgCarrierCapacityTick = Game.time;
        return average;
    }
    sources() {
        if (!global.room[this.name].sources) {
            let sources = this.find(FIND_SOURCES).map(item => {
                return item.id;
            });
            global.room[this.name].sources = sources;
            return sources;
        }
        else {
            return global.room[this.name].sources;
        }
    }
    containerPos() {
        var _a, _b;
        const sources = this.sources();
        // 按 sourceId 缓存，避免 sources 顺序变化（global 重置/代码推送）后下标错位
        const byId = (_a = this.memory.containerPosById) !== null && _a !== void 0 ? _a : {};
        const legacy = (_b = this.memory.containerPos) !== null && _b !== void 0 ? _b : [];
        const containerPos = [];
        const rememberPos = (sourceId, pos) => {
            const point = [pos.x, pos.y];
            byId[sourceId] = point;
            containerPos.push(point);
        };
        sources.forEach((item, index) => {
            var _a;
            const source = Game.getObjectById(item);
            if (!source) {
                return;
            }
            // container 没有 owner，必须用 FIND_STRUCTURES；FIND_MY_STRUCTURES 永远查不到
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (object) => object.structureType === STRUCTURE_CONTAINER
            });
            if (containers.length > 0) {
                // 已经建好的 container 优先复用，绝不在别处另起工地
                rememberPos(item, containers[0].pos);
                return;
            }
            const constructionSites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
                filter: { structureType: STRUCTURE_CONTAINER }
            });
            if (constructionSites.length > 0) {
                rememberPos(item, constructionSites[0].pos);
                return;
            }
            let cachedPos = byId[item];
            if (!cachedPos && legacy[index]) {
                // 旧缓存是按 sources 下标存的，global 重置后顺序可能变化，必须校验是否贴着这个矿点
                const candidate = legacy[index];
                const candidatePos = this.getPositionAt(candidate[0], candidate[1]);
                if (candidatePos && candidatePos.inRangeTo(source, 1)) {
                    cachedPos = [candidate[0], candidate[1]];
                }
            }
            if (cachedPos) {
                const pos = this.getPositionAt(cachedPos[0], cachedPos[1]);
                if (pos) {
                    rememberPos(item, pos);
                }
                return;
            }
            const direction = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1], [0, 1],
                [1, -1], [1, 0], [1, 1]
            ];
            const containerPosList = [];
            for (const [xx, yy] of direction) {
                const x = xx + source.pos.x;
                const y = yy + source.pos.y;
                const pos = new RoomPosition(x, y, this.name);
                if (pos.lookFor(LOOK_TERRAIN)[0] != 'wall') {
                    const targetPos = this.getPositionAt(x, y);
                    if (targetPos) {
                        containerPosList.push(targetPos);
                    }
                }
            }
            if (!containerPosList.length) {
                return;
            }
            let finalPos = containerPosList[0];
            let anchorPos = null;
            if (this.memory.roomPlanType === 2 && ((_a = this.memory.plan2Pos) === null || _a === void 0 ? void 0 : _a.core)) {
                anchorPos = this.memory.plan2Pos.core;
            }
            else if (this.memory.plan1Pos) {
                anchorPos = this.memory.plan1Pos;
            }
            const planPos = anchorPos
                ? this.getPositionAt(anchorPos[0], anchorPos[1])
                : null;
            if (planPos) {
                const bestPos = planPos.findClosestByPath(containerPosList, { algorithm: "astar" });
                if (bestPos) {
                    finalPos = bestPos;
                }
            }
            rememberPos(item, finalPos);
            // 目标格已经有建筑/工地时不再创建，避免重复工地
            if (finalPos.lookFor(LOOK_STRUCTURES).length || finalPos.lookFor(LOOK_CONSTRUCTION_SITES).length) {
                return;
            }
            const createResult = this.createConstructionSite(finalPos.x, finalPos.y, STRUCTURE_CONTAINER);
            if (createResult == OK) {
                const site = finalPos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
                if (site) {
                    this.registTask(construct(site.id));
                }
            }
        });
        this.memory.containerPosById = byId;
        this.memory.containerPos = containerPos;
        return containerPos;
    }
    /**
     * autoPlan相关
     */
    loadTerrain() {
        let mapBuffer = initializeArray(50, 50);
        let terrain = this.getTerrain();
        for (let i = 0; i < 50; i++) {
            for (let j = 0; j < 50; j++) {
                if (terrain.get(i, j) == TERRAIN_MASK_WALL) {
                    mapBuffer[i][j] = 0;
                }
                else {
                    mapBuffer[i][j] = 1;
                }
            }
        }
        global.room[this.name].terrainMap = mapBuffer;
    }
    calDistance(x, y) {
        if (!global.room[this.name] || !global.room[this.name].terrainMap) {
            this.loadTerrain();
        }
        const terrainMap = global.room[this.name].terrainMap;
        let queue = [];
        let directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];
        let bfsMap = initializeArray(50, 50);
        function outOfMap(x, y) {
            return x < 0 || x > 49 || x < 0 || y > 49;
        }
        queue.push([x, y]);
        while (queue.length > 0) {
            let xx;
            let yy;
            [xx, yy] = queue.shift();
            for (const direction of directions) {
                const dx = direction[0] + xx;
                const dy = direction[1] + yy;
                if (!outOfMap(dx, dy) && !bfsMap[dx][dy] && terrainMap[dx][dy]) {
                    bfsMap[dx][dy] = bfsMap[xx][yy] + 1;
                    queue.push([dx, dy]);
                }
            }
        }
        return bfsMap;
    }
    getBiggestSquare(threshold) {
        // console.log("getBiggestSquare")
        if (!global.room[this.name] || !global.room[this.name].terrainMap) {
            this.loadTerrain();
        }
        let mapBuffer = global.room[this.name].terrainMap;
        let anchors = [];
        // 动态规划遍历所有点
        for (let x = 3; x < 48; x++) {
            for (let y = 3; y < 48; y++) {
                if (mapBuffer[x][y]) { // 如果是空地
                    mapBuffer[x][y] = 1 + Math.min(mapBuffer[x - 1][y - 1], mapBuffer[x - 1][y], mapBuffer[x][y - 1]); // 递推公式
                    if (mapBuffer[x][y] >= threshold) { // 大于阈值
                        anchors.push([x, y]); // 记录坐标
                    }
                } // else buffer[x][y] = 0 即初始值
            }
        }
        // visualizeSquare(anchors, mapBuffer, this.name)
        // this.visualizeMap(mapBuffer)
        // this.visualizeMap(mapBuffer)
        return anchors;
    }
    checkError() {
        if (!this.memory.timer) {
            this.memory.timer = {};
            return;
        }
        for (const tick in this.memory.timer) {
            // console.log(tick)
            if (Number(tick) < Game.time) {
                delete this.memory.timer[tick];
            }
            else {
                break;
            }
        }
    }
    visualizeMap(map) {
        const visualTarget = this.visual;
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                visualTarget.text(map[x][y], x, y);
            }
        }
    }
    calPerfectBasePos() {
        if (!global.room[this.name]) {
            global.room[this.name] = {};
        }
        // Prepare BFS maps if not exist
        if (!global.room[this.name].sourceBFS) {
            const sourcesPos = this.sources().map(item => {
                const sourcePos = Game.getObjectById(item);
                return [sourcePos.pos.x, sourcePos.pos.y];
            });
            global.room[this.name].sourceBFS = [];
            for (const [x, y] of sourcesPos) {
                global.room[this.name].sourceBFS.push(this.calDistance(x, y));
            }
        }
        if (!global.room[this.name].controllerBFS) {
            global.room[this.name].controllerBFS = [];
            global.room[this.name].controllerBFS.push(this.calDistance(this.controller.pos.x, this.controller.pos.y));
        }
        // Try Plan 1
        const plan1Pos = this.calPlan1Pos();
        if (plan1Pos) {
            this.memory.roomPlanType = 1;
            this.memory.plan1Pos = plan1Pos;
            return plan1Pos;
        }
        // Try Plan 2
        const plan2Pos = this.calPlan2Pos();
        if (plan2Pos) {
            this.memory.roomPlanType = 2;
            this.memory.plan2Pos = plan2Pos;
            // Use core position as basePos for compatibility
            this.memory.plan1Pos = plan2Pos.core;
            return plan2Pos.core;
        }
        return undefined;
    }
    calPlan1Pos() {
        if (!global.room[this.name].possibleBase) {
            // Plan 1 uses 11x11, but original code used 13, likely for padding
            const anchor = this.getBiggestSquare(13);
            global.room[this.name].possibleBase = anchor;
        }
        const possibleBase = global.room[this.name].possibleBase;
        const sourceBFS = global.room[this.name].sourceBFS;
        const controllerBFS = global.room[this.name].controllerBFS;
        let minCost = 999;
        let [xx, yy] = [-1, -1];
        for (const [x, y] of possibleBase) {
            let cost = 0;
            sourceBFS.forEach(item => {
                cost += item[x - 6][y - 6];
            });
            controllerBFS.forEach(item => {
                cost += item[x - 6][y - 6];
            });
            if (cost < minCost) {
                [xx, yy] = [x, y];
                minCost = cost;
            }
        }
        if (xx == -1)
            return undefined;
        return [xx, yy];
    }
    calPlan2Pos() {
        const sourceBFS = global.room[this.name].sourceBFS;
        const controllerBFS = global.room[this.name].controllerBFS;
        // 1. Core (7x7)
        const coreAnchors = this.getBiggestSquare(7);
        if (coreAnchors.length === 0)
            return undefined;
        let bestCore = null;
        let minCoreCost = Infinity;
        for (const [x, y] of coreAnchors) {
            let cost = 0;
            // Center of 7x7 (0..6) is 3.
            const cx = x - 3;
            const cy = y - 3;
            sourceBFS.forEach(bfs => cost += bfs[cx][cy]);
            controllerBFS.forEach(bfs => cost += bfs[cx][cy]);
            if (cost < minCoreCost) {
                minCoreCost = cost;
                bestCore = [x, y];
            }
        }
        if (!bestCore)
            return undefined;
        // 2. Ext1 (6x6) - Nearest to Source 0
        const extAnchors = this.getBiggestSquare(6);
        let bestExt1 = null;
        let minExt1Cost = Infinity;
        const source0BFS = sourceBFS[0];
        for (const [x, y] of extAnchors) {
            if (this.checkOverlap(bestCore, 7, [x, y], 6))
                continue;
            const cx = x - 3; // Center approx
            const cy = y - 3;
            // Use Source 0 distance
            const cost = source0BFS[cx][cy];
            if (cost < minExt1Cost) {
                minExt1Cost = cost;
                bestExt1 = [x, y];
            }
        }
        if (!bestExt1)
            return undefined;
        // 3. Ext2 (6x6) - Nearest to Source 1 (or 0)
        let bestExt2 = null;
        let minExt2Cost = Infinity;
        const source1BFS = sourceBFS.length > 1 ? sourceBFS[1] : sourceBFS[0];
        for (const [x, y] of extAnchors) {
            if (this.checkOverlap(bestCore, 7, [x, y], 6))
                continue;
            if (this.checkOverlap(bestExt1, 6, [x, y], 6))
                continue;
            const cx = x - 3;
            const cy = y - 3;
            const cost = source1BFS[cx][cy];
            if (cost < minExt2Cost) {
                minExt2Cost = cost;
                bestExt2 = [x, y];
            }
        }
        if (!bestExt2)
            return undefined;
        // 4. Lab (4x4) - Nearest to others
        const labAnchors = this.getBiggestSquare(4);
        let bestLab = null;
        let minLabCost = Infinity;
        const coreCenter = [bestCore[0] - 3, bestCore[1] - 3];
        const ext1Center = [bestExt1[0] - 3, bestExt1[1] - 3];
        const ext2Center = [bestExt2[0] - 3, bestExt2[1] - 3];
        for (const [x, y] of labAnchors) {
            if (this.checkOverlap(bestCore, 7, [x, y], 4))
                continue;
            if (this.checkOverlap(bestExt1, 6, [x, y], 4))
                continue;
            if (this.checkOverlap(bestExt2, 6, [x, y], 4))
                continue;
            const cx = x - 2;
            const cy = y - 2;
            const dist = this.getRange(cx, cy, coreCenter[0], coreCenter[1]) +
                this.getRange(cx, cy, ext1Center[0], ext1Center[1]) +
                this.getRange(cx, cy, ext2Center[0], ext2Center[1]);
            if (dist < minLabCost) {
                minLabCost = dist;
                bestLab = [x, y];
            }
        }
        if (!bestLab)
            return undefined;
        return {
            core: bestCore,
            ext1: bestExt1,
            ext2: bestExt2,
            lab: bestLab
        };
    }
    checkOverlap(pos1, size1, pos2, size2, padding = 1) {
        // pos is bottom-right [x, y]
        // Rect: [pos[0]-size+1, pos[1]-size+1] to [pos[0], pos[1]]
        const l1 = pos1[0] - size1 + 1 - padding;
        const r1 = pos1[0] + padding;
        const t1 = pos1[1] - size1 + 1 - padding;
        const b1 = pos1[1] + padding;
        const l2 = pos2[0] - size2 + 1;
        const r2 = pos2[0];
        const t2 = pos2[1] - size2 + 1;
        const b2 = pos2[1];
        return !(l1 > r2 || r1 < l2 || t1 > b2 || b1 < t2);
    }
    getRange(x1, y1, x2, y2) {
        return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
    }
    visualize(level = 0) {
        const planType = this.memory.roomPlanType || 1;
        if (planType === 2) {
            const plan2Pos = this.memory.plan2Pos;
            this.visualize_plan2(level, plan2Pos);
        }
        else {
            if (!this.memory.plan1Pos)
                return;
            const [xx, yy] = this.memory.plan1Pos;
            this.visualize_plan1(plan1, xx, yy, level);
        }
    }
    visualize_plan1(map, xx, yy, level = 0) {
        const visualTarget = this.visual;
        for (let y = 0; y < map.length; y++) {
            const row = map[y].split(" ");
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue;
                    }
                }
                const structureType = mapping[row[x][0]];
                visualTarget.structure(xx + x - map.length, yy + y - map.length, structureType);
            }
        }
    }
    visualize_plan2(level, plan2Pos) {
        if (!plan2Pos)
            return;
        const { core, ext1, ext2, lab } = plan2Pos;
        this.visualize_layout(plan2_Core, core, level);
        this.visualize_layout(plan2_extensionCluster1, ext1, level);
        this.visualize_layout(plan2_extensionCluster2, ext2, level);
        this.visualize_layout(plan2_Lab, lab, level);
    }
    visualize_layout(map, pos, level) {
        const visualTarget = this.visual;
        let [xx, yy] = pos;
        for (let y = 0; y < map.length; y++) {
            const row = map[y].split(" ");
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue;
                    }
                }
                const structureType = mapping[row[x][0]];
                if (structureType && structureType !== "Null") {
                    visualTarget.structure(xx + x - map.length + 1, yy + y - map.length + 1, structureType);
                }
            }
        }
    }
    showRoomPlan() {
        if (!this.memory.plan1Pos)
            return;
        for (let i = 1; i <= 8; i++) {
            this.registEvent(showRoomPlanEvent(Game.time + i, i % 8 + 1));
        }
    }
    construct(level) {
        if (!this.memory.plan1Pos) {
            this.calPerfectBasePos();
        }
        if (!this.memory.plan1Pos) {
            console.log(`[${this.name}] Warning: Cannot find perfect base position, skipping construction.`);
            return;
        }
        if (this.memory.roomPlanType === 2) {
            this.constructPlan2(level);
        }
        else {
            this.constructPlan1(level);
        }
    }
    constructPlan1(level) {
        let [xx, yy] = this.memory.plan1Pos;
        for (let y = 0; y < plan1.length; y++) {
            const row = plan1[y].split(" ");
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue;
                    }
                }
                const structureType = mapping[row[x][0]];
                this.createConstructionSite(xx + x - plan1.length, yy + y - plan1.length, structureType);
            }
        }
    }
    constructPlan2(level) {
        if (!this.memory.plan2Pos)
            return;
        const { core, ext1, ext2, lab } = this.memory.plan2Pos;
        this.buildLayout(plan2_Core, core, level);
        this.buildLayout(plan2_extensionCluster1, ext1, level);
        this.buildLayout(plan2_extensionCluster2, ext2, level);
        this.buildLayout(plan2_Lab, lab, level);
    }
    buildLayout(map, pos, level) {
        let [xx, yy] = pos;
        for (let y = 0; y < map.length; y++) {
            const row = map[y].split(" ");
            for (let x = 0; x < row.length; x++) {
                if (level) {
                    if (row[x].length <= 1 || Number(row[x][1]) > level) {
                        continue;
                    }
                }
                const structureType = mapping[row[x][0]];
                if (structureType && structureType !== "Null") {
                    this.createConstructionSite(xx + x - map.length + 1, yy + y - map.length + 1, structureType);
                }
            }
        }
    }
}

/**
 * 房间环境扫描：低频执行 find，把结果以 id 的形式缓存在 global.room 中，
 * 塔每 tick 只做 O(1) 的缓存读取，避免所有塔重复 find。
 */
class RoomScanExtension extends Room {
    scan() {
        const cache = global.room[this.name];
        if (!cache) {
            return;
        }
        const now = Game.time;
        // 防御状态下每 tick 重新确认敌对目标；和平状态按间隔扫描
        if (cache.threatMode === 'defend'
            || cache.lastThreatScan === undefined
            || now - cache.lastThreatScan >= towerSetting.threatScanInterval) {
            cache.lastThreatScan = now;
            this.refreshThreat(cache);
        }
        if (cache.lastRepairScan === undefined
            || now - cache.lastRepairScan >= towerSetting.repairScanInterval) {
            cache.lastRepairScan = now;
            this.refreshRepairQueue(cache);
            // 维修队列刷新后同步 worker 的维修任务，次数与扫描同频（15 tick 一次）
            this.syncRepairTasks();
        }
        if (cache.lastMaintenanceScan === undefined
            || now - cache.lastMaintenanceScan >= wallSetting.scanInterval) {
            cache.lastMaintenanceScan = now;
            this.refreshMaintenanceQueue(cache);
            this.syncWallRepairTasks();
        }
        // container / 掉落物会变化，定期把新出现的能量来源补进 energyTask 队列
        if (cache.lastEnergyTaskScan === undefined
            || now - cache.lastEnergyTaskScan >= 10) {
            cache.lastEnergyTaskScan = now;
            this.refreshEnergyTasks();
            // spawn/extension 的补能需求同样按间隔兜底同步
            this.refreshEnergyCarryTasks();
            // 工地状态变化后升级并发要跟着调整
            this.refreshUpgradeTask();
            // 外矿任务和补员：任务登记在主房队列，孵化受"富余能量"门槛控制
            // 先按最新情报补全外矿计划（相邻房、unsafe 过滤），再同步任务/补员
            this.syncRemotePlan();
            this.refreshRemoteTasks();
            this.refreshRemoteSpawn();
        }
        // 兜底重建 spawn/extension 顺序表，处理漏掉的建成/拆除
        if (cache.lastEnergyStructureScan === undefined
            || now - cache.lastEnergyStructureScan >= energyStructureScanInterval) {
            cache.lastEnergyStructureScan = now;
            this.refreshEnergyStructures();
        }
        // 兜底刷新 container 列表（建成有 buildOver 事件，这里处理漏网/被拆）
        if (cache.lastContainerScan === undefined
            || now - cache.lastContainerScan >= containerScanInterval) {
            this.refreshContainers();
        }
    }
    refreshThreat(cache) {
        var _a;
        const hostiles = this.find(FIND_HOSTILE_CREEPS);
        cache.hostileIds = hostiles.map(creep => creep.id);
        const hurt = this.find(FIND_MY_CREEPS)
            .filter(creep => creep.hits < creep.hitsMax)
            .sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax);
        cache.hurtCreepIds = hurt.map(creep => creep.id);
        if (hostiles.length) {
            cache.threatMode = 'defend';
            cache.calmTicks = 0;
            return;
        }
        if (cache.threatMode === 'defend') {
            cache.calmTicks = ((_a = cache.calmTicks) !== null && _a !== void 0 ? _a : 0) + 1;
            if (cache.calmTicks >= towerSetting.calmTicksToPeace) {
                cache.threatMode = 'peace';
                cache.calmTicks = 0;
            }
            return;
        }
        cache.threatMode = 'peace';
        cache.calmTicks = 0;
    }
    refreshRepairQueue(cache) {
        const damaged = this.find(FIND_STRUCTURES, {
            filter: (object) => {
                if (object.structureType == STRUCTURE_CONTROLLER
                    || object.structureType == STRUCTURE_WALL
                    || object.structureType == STRUCTURE_RAMPART) {
                    return false;
                }
                // 不维修其他玩家的建筑；中立建筑（道路/容器）没有 owner，正常纳入
                if (object.owner && !object.my) {
                    return false;
                }
                return object.hits < object.hitsMax * towerSetting.repairThreshold;
            }
        });
        damaged.sort((a, b) => {
            const priorityDiff = repairPriority(a.structureType) - repairPriority(b.structureType);
            if (priorityDiff) {
                return priorityDiff;
            }
            return a.hits / a.hitsMax - b.hits / b.hitsMax;
        });
        cache.repairQueue = damaged.map(structure => structure.id);
    }
    /**
     * 墙体/防御墙维护队列。只有 storage 能量充足时才扫描，
     * 目标血量按 controller level 从 wallSetting.targetHits 取。
     */
    refreshMaintenanceQueue(cache) {
        var _a;
        const storage = this.storage;
        const targetHits = this.controller
            ? (_a = wallSetting.targetHits[this.controller.level]) !== null && _a !== void 0 ? _a : 0
            : 0;
        if (!storage || storage.store[RESOURCE_ENERGY] < wallSetting.minStorageEnergy || !targetHits) {
            cache.maintenanceQueue = [];
            return;
        }
        const damaged = this.find(FIND_STRUCTURES, {
            filter: (object) => {
                if (object.structureType != STRUCTURE_WALL && object.structureType != STRUCTURE_RAMPART) {
                    return false;
                }
                if (object.owner && !object.my) {
                    return false;
                }
                return object.hits < targetHits;
            }
        });
        damaged.sort((a, b) => {
            // 先修 rampart（保护站在上面的 creep），同类型优先修血量最低的
            const priorityA = a.structureType == STRUCTURE_RAMPART ? 0 : 1;
            const priorityB = b.structureType == STRUCTURE_RAMPART ? 0 : 1;
            if (priorityA != priorityB) {
                return priorityA - priorityB;
            }
            return a.hits - b.hits;
        });
        cache.maintenanceQueue = damaged
            .slice(0, wallSetting.queueSize)
            .map(structure => structure.id);
    }
    dropRepairTarget(id) {
        const cache = global.room[this.name];
        if (!cache || !cache.repairQueue) {
            return;
        }
        const index = cache.repairQueue.indexOf(id);
        if (index >= 0) {
            cache.repairQueue.splice(index, 1);
        }
    }
}

var mountRoom = () => {
    console.log("+ Mounting Room extension");
    assignPrototype(Room, RoomExtension);
    assignPrototype(Room, RoomScanExtension);
};

class ControllerExtension extends StructureController {
    checkLevel() {
        return true;
    }
}

const spawnCreepErrorDescription = {
    '0': '这个操作已经成功纳入计划',
    '-1': '你不是该母巢 (spawn) 的所有者',
    '-3': '已经有一个叫这个名字的 creep 了',
    '-4': '这个母巢 (spawn) 已经在孵化另一个 creep 了',
    '-6': '这个母巢 (spawn) 和他的扩展包含的能量不足以孵化具有给定 body 的 creep',
    '-10': 'Body 没有被恰当地描述',
    '-14': '您的房间控制器级别不足以使用此 spawn'
};

// /**
class SpawnExtension extends Spawn {
    /**
     * spawn使用carrier的usingData来计算当前是否可以孵化
     * 将使用的extension和spawn暂存到一个列表中
     * 然后孵化,如果没有出错的话将对应的列表连接到dataPool后
     * 如果孵化出现问题,refresh carrierList,并将
     */
    work() {
        var _a, _b, _c, _d;
        // log.debug("spawn working")
        if (this.spawning) {
            // 孵化可视化
            const spawningCreep = Game.creeps[this.spawning.name];
            this.room.visual.text('🛠️' + spawningCreep.memory.role, this.pos.x + 1, this.pos.y, { align: 'left', opacity: 0.8 });
            return;
        }
        else {
            const spawnBuckets = this.room.normalizeTaskBuckets('spawnTask');
            const bucketKeys = Object.keys(spawnBuckets).map(Number).sort((a, b) => a - b);
            let spawnQueue;
            let activeKey;
            for (const key of bucketKeys) {
                const bucket = spawnBuckets[String(key)];
                if (bucket && bucket.length) {
                    spawnQueue = bucket;
                    activeKey = String(key);
                    break;
                }
            }
            if (!spawnQueue || !spawnQueue.length) {
                return;
            }
            else {
                const task = spawnQueue[0];
                const role = (_a = task === null || task === void 0 ? void 0 : task.taskParam) === null || _a === void 0 ? void 0 : _a[0];
                let rolePart = (_b = task === null || task === void 0 ? void 0 : task.taskParam) === null || _b === void 0 ? void 0 : _b[1];
                if (!role || !rolePart) {
                    spawnQueue.shift();
                    if (activeKey && spawnQueue.length === 0) {
                        delete spawnBuckets[activeKey];
                    }
                    return;
                }
                let energyNeeded = CalBodyCost(rolePart);
                this.room.visual.text('🛠️' + role, this.pos.x + 1, this.pos.y, { align: 'left', opacity: 0.8, font: "20px" });
                this.room.visual.text("💸" + energyNeeded + "\n", this.pos.x + 1, this.pos.y + 1, { align: 'left', opacity: 0.8, font: "20px" });
                this.room.visual.text("💰" + this.room.energyAvailable + "\n", this.pos.x + 1, this.pos.y + 2, { align: 'left', opacity: 0.8, font: "20px" });
                if (this.room.energyAvailable < energyNeeded) {
                    // 正常情况等 carryTask 补能即可；等太久说明房间已经补不上能量
                    // （典型是 carrier 全灭），按当前能量换一个买得起的最小体型先孵出来，
                    // 否则 priority 0 的大体型任务会把后面的 carrier/worker 全部堵死。
                    const waited = task.queuedAt === undefined ? 0 : Game.time - task.queuedAt;
                    if (waited < spawnSetting.affordWaitTicks) {
                        return;
                    }
                    // 能量还在增长：说明房间正在回血（carrier 在往 spawn/extension 搬），
                    // 继续等，不要急着把大体型任务砍成小体型。只有连续一个窗口都不增长
                    // 才兜底；同时用总时长硬上限保证一定会有结果。
                    if (task.queuedEnergy !== undefined && this.room.energyAvailable > task.queuedEnergy) {
                        task.queuedEnergy = this.room.energyAvailable;
                        task.queuedAt = Game.time;
                        const age = task.createdAt === undefined ? 0 : Game.time - task.createdAt;
                        if (age < spawnSetting.affordMaxWaitTicks) {
                            return;
                        }
                    }
                    const fallbackBody = getBodyForEnergy(role, this.room, this.room.energyAvailable);
                    if (!fallbackBody) {
                        return;
                    }
                    task.taskParam[1] = fallbackBody;
                    rolePart = fallbackBody;
                    energyNeeded = CalBodyCost(fallbackBody);
                    if (this.room.energyAvailable < energyNeeded) {
                        return;
                    }
                }
                if (this.room.energyAvailable >= energyNeeded) {
                    // 按布局集群顺序挑"刚好够"的结构，不做存量排序。
                    // spawnCreep 会严格按这个顺序扣能量。
                    const picked = this.room.pickEnergyStructures(energyNeeded);
                    if (!picked) {
                        // 能量结构顺序表可能还没同步好，下一 tick 再试
                        return;
                    }
                    let creepName = role + Game.time;
                    let res = this.spawnCreep(rolePart, creepName, {
                        memory: {
                            role: role,
                            spawnRoom: this.room.name,
                            working: false,
                            // 任务参数里显式带 false 的角色（remoteCarrier）死亡后
                            // 由 refreshRemoteCarrierSpawn 按门槛补员，不走 creepRecycle 无条件重孵
                            reSpawn: ((_c = task === null || task === void 0 ? void 0 : task.taskParam) === null || _c === void 0 ? void 0 : _c[3]) !== false,
                            // 提前换班的 harvester 会带上矿点 id
                            harvestSourceId: (_d = task === null || task === void 0 ? void 0 : task.taskParam) === null || _d === void 0 ? void 0 : _d[2]
                        },
                        energyStructures: picked.structures
                    });
                    if (res == OK) {
                        /* 孵化成功 */
                        spawnQueue.shift();
                        if (activeKey && spawnQueue.length === 0) {
                            delete spawnBuckets[activeKey];
                        }
                        // spawnCreep 是 intent，回合末才扣能量；下一 tick 给实际
                        // 被扣空的结构登记补能需求，再由 calSpawningTime 安排 recycle
                        this.room.registEvent({
                            triggerTime: Game.time + 1,
                            triggerFunc: "refillAfterSpawn",
                            param: [picked.usedIds]
                        });
                        this.room.registEvent({
                            triggerTime: Game.time + 1,
                            triggerFunc: "calSpawningTime",
                            param: [this.id]
                        });
                    }
                    else {
                        loggerInstance.error("孵化失败,报错原因: " + spawnCreepErrorDescription[res]);
                    }
                }
            }
            //TODO:孵化,注意计算spawnCreep,返回状态,如果状态不对需要refresh carrier, 同时要把所有的carry全部free掉
        }
    }
    /**
     * 在spawn修好的时候，如果是第一个spawn需要对spawn所在的room从新矿转化为主矿
     */
    onBuild() {
    }
}

class ExtensionExtension extends StructureExtension {
    onBuild() {
        this.room.addExtensionCarryTasks([this.id]);
    }
}

/**
 * 塔的逻辑：只读 global.room 中的扫描缓存，不在每 tick 做 find。
 * 优先级：攻击敌对 creep > 治疗己方 creep > 维修建筑 > 请求补能。
 */
class TowerExtension extends StructureTower {
    work() {
        const room = this.room;
        const cache = room ? global.room[room.name] : undefined;
        if (!room || !cache) {
            return;
        }
        if (this.attackHostile(cache.hostileIds)) {
            this.ensureEnergySupply(cache);
            return;
        }
        if (this.healCreep(cache.hurtCreepIds)) {
            this.ensureEnergySupply(cache);
            return;
        }
        if (this.canRepair() && cache.repairQueue && cache.repairQueue.length) {
            this.repairNext(cache.repairQueue, room);
        }
        this.ensureEnergySupply(cache);
    }
    /**
     * 攻击敌对 creep。优先打射程内的，没有则退而求其次打射程内的最远目标。
     * @return 是否执行了攻击（无论游戏 API 返回什么，都不再做后续动作）
     */
    attackHostile(ids) {
        if (!ids || !ids.length) {
            return false;
        }
        let fallback;
        for (const id of ids) {
            const target = Game.getObjectById(id);
            if (!target) {
                continue;
            }
            if (this.pos.inRangeTo(target, TOWER_OPTIMAL_RANGE)) {
                this.attack(target);
                return true;
            }
            if (!fallback && this.pos.inRangeTo(target, TOWER_FALLOFF_RANGE)) {
                fallback = target;
            }
        }
        if (fallback) {
            this.attack(fallback);
            return true;
        }
        return false;
    }
    /**
     * 治疗己方受伤 creep，缓存里已经按血量比例升序排好。
     */
    healCreep(ids) {
        if (!ids || !ids.length) {
            return false;
        }
        let fallback;
        for (const id of ids) {
            const target = Game.getObjectById(id);
            // 扫描缓存有间隔，期间可能已经治满，避免继续浪费能量
            if (!target || target.hits >= target.hitsMax) {
                continue;
            }
            if (this.pos.inRangeTo(target, TOWER_OPTIMAL_RANGE)) {
                this.heal(target);
                return true;
            }
            if (!fallback && this.pos.inRangeTo(target, TOWER_FALLOFF_RANGE)) {
                fallback = target;
            }
        }
        if (fallback) {
            this.heal(fallback);
            return true;
        }
        return false;
    }
    repairNext(queue, room) {
        while (queue.length) {
            const id = queue[0];
            const target = Game.getObjectById(id);
            if (!target || target.hits >= target.hitsMax) {
                room.dropRepairTarget(id);
                continue;
            }
            const result = this.repair(target);
            if (result == ERR_NOT_ENOUGH_ENERGY || result == OK) {
                return;
            }
            // 目标已经不可维修（被摧毁/换手等），移出队列，避免下 tick 死循环
            room.dropRepairTarget(id);
            return;
        }
    }
    canRepair() {
        const energy = this.store.getUsedCapacity(RESOURCE_ENERGY);
        return energy >= this.store.getCapacity(RESOURCE_ENERGY) * towerSetting.repairReserve;
    }
    /**
     * 能量不足时通过 room 的 carryTask 申请补给；同一座塔按 refillInterval 节流，
     * ensureEnergyCarryTask 内部还会按目标 id 去重，因此不会重复登记任务。
     */
    ensureEnergySupply(cache) {
        const energy = this.store.getUsedCapacity(RESOURCE_ENERGY);
        if (energy >= this.store.getCapacity(RESOURCE_ENERGY) * towerSetting.refillThreshold) {
            return;
        }
        if (!cache.refillTicks) {
            cache.refillTicks = {};
        }
        const lastTick = cache.refillTicks[this.id];
        const now = Game.time;
        if (lastTick !== undefined && now - lastTick < towerSetting.refillInterval) {
            return;
        }
        cache.refillTicks[this.id] = now;
        this.room.ensureEnergyCarryTask(this.id);
    }
}

// import { LinkExtension, LinkConsole } from './link'
// import ExtractorExtension from './extractor'
// import RampartExtension from './rampart'
// import StorageExtension from './storage'
// import NukerExtension from './nuker'
// import { PowerSpawnExtension, PowerSpawnConsole } from './powerSpawn'
// import { ObserverExtension, ObserverConsole } from './observer'
// import { FactoryExtension, FactoryConsole } from './factory'
// import { TerminalExtension, TerminalConsole } from "./terminal"
// import LabExtension from "./lab"
// import StructureExtension from './structure'
const assignMap = [
    // [ Structure, StructureExtension ],
    [StructureController, ControllerExtension],
    [StructureSpawn, SpawnExtension],
    [StructureExtension, ExtensionExtension],
    [StructureTower, TowerExtension],
    // [StructureExtractor, RampartExtension],
    // [ StructureLink, LinkExtension ],
    // [ StructureLink, LinkConsole ],
    // [ StructureFactory, FactoryExtension ],
    // [ StructureFactory, FactoryConsole ],
    // [ StructureTerminal, TerminalExtension ],
    // [ StructureTerminal, TerminalConsole ],
    // [ StructureExtractor, ExtractorExtension ],
    // [ StructureStorage, StorageExtension ],
    // [ StructureLab, LabExtension ],
    // [ StructureNuker, NukerExtension ],
    // [ StructurePowerSpawn, PowerSpawnExtension ],
    // [ StructurePowerSpawn, PowerSpawnConsole ],
    // [ StructureObserver, ObserverExtension ],
    // [ StructureObserver, ObserverConsole ]
];
var mountStructure = () => {
    // 挂载所有拓展
    console.log("+ Mounting Structure extension");
    assignMap.forEach(protos => assignPrototype(protos[0], protos[1]));
};

const rootNodes = [
    /**
     *  Console: 启动控制台模式
     *  控制台模式下:
     *      Global: 全局选项
     *      Rooms: 房间选项
     *      Quit: 退出Console模式
     */
    {
        alias: "Console",
        exec: function () {
            loggerInstance.setLevel("CONSOLE");
            global.nodeList = [rootNodes];
            global.cmdList = ["Console"];
            LoadFunction(ConsoleNodes);
            const menu = "控制台模式\n" +
                "> Global\t\t\t全局选项\n" +
                "> Rooms\t\t\t\t房间选项\n" +
                "> help\t\t\t\t查看函数帮助\n" +
                "> quit\t\t\t\t退出控制台\n";
            global.currentMenu = menu;
            return menu;
        },
        help: "Console: 启动控制台模式\n" +
            "控制台模式下:\n" +
            "\tGlobal: 全局选项\n" +
            "\tRooms: 房间选项\n" +
            "\tQuit: 退出Console模式\n"
    },
    {
        alias: "help",
        exec: function () {
            return global.helpText;
        },
        help: ""
    }
];
const quit = {
    alias: "quit",
    exec: function () {
        loggerInstance.setLevel("DEBUG");
        delete global.currentRoom;
        delete global.nodeList;
        UnloadFunction();
        return "退出控制台模式";
    },
    help: "quit\n" +
        "\t退出控制台\n" +
        "\t这里做了一些处理, 将全局log等级重置为DEBUG模式\n"
};
const back = {
    alias: "back",
    exec: function () {
        global.nodeList.pop();
        global.nodeList.pop();
        global.cmdList.pop();
        const nodes = global.nodeList[global.nodeList.length - 1];
        const alias = global.cmdList.pop();
        return nodes.find(node => {
            if (node.alias == alias)
                return node;
        }).exec();
    },
    help: "back\n" +
        "\t返回上一级菜单\n"
};
const ConsoleNodes = [
    /**
     *  Global子选项
     *  Restart: 全局重启
     */
    {
        alias: "Global",
        exec: function () {
            const menu = "全局选项:\n" +
                "> init\t\t\t\t全局初始化\n" +
                "> log\t\t\t\t全局日志记录\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n";
            NextMenu("Global", menu, GlobalNodes);
            return menu;
        },
        help: "Global\n" +
            "\t用于加载全局选项,包括全局初始化等操作\n"
    },
    {
        alias: "Rooms",
        exec: function () {
            const menu = "全局选项:\n" +
                "> chooseRoom\t\t\t选择房间\n" +
                "> autoPlan\t\t\t自动规划\n" +
                "> memoryInfo\t\t\t打印内存信息\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n";
            NextMenu("Rooms", menu, RoomNodes);
            return menu;
        },
        help: "Global\n" +
            "\t用于加载全局选项,包括全局初始化等操作\n"
    },
    /**
     *  退出控制台
     *  退出控制台模式并进行必要的清理和设置:
     *  设置ConsoleMod为log模式
     *  清理ChosenRoom变量
     */
    quit
];
const GlobalNodes = [
    {
        alias: "init",
        exec: function () {
            console.log("清理全局room缓存");
            global.room = {};
            for (const room in Game.rooms) {
                Game.rooms[room].init();
            }
            return "全局初始化执行完毕\n" + global.currentMenu;
        },
        help: "init\n" +
            "\t这个函数还没有写\n"
    },
    {
        alias: "log",
        exec: function () {
            const menu = "日志模式\n" +
                "> debug\t\t\t\tdebug模式\n" +
                "> info\t\t\t\tinfo模式\n" +
                "> warning\t\t\twarning模式\n" +
                "> error\t\t\t\terror模式\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n";
            NextMenu("log", menu, logNodes);
            return menu;
        },
        help: "log\n" +
            "\t修改全局日志等级\n"
    },
    back,
    quit
];
const logNodes = [
    {
        alias: "debug",
        exec: function () {
            global.logLevel = "DEBUG";
            return "全局log等级调整至DEBUG等级\n" + global.currentMenu;
        },
        help: "debug\n" +
            "\t将全局log等级调整至DEBUG等级, 在退出控制台时生效\n"
    },
    {
        alias: "info",
        exec: function () {
            global.logLevel = "INFO";
            return "全局log等级调整至INFO等级\n" + global.currentMenu;
        },
        help: "info\n" +
            "\t将全局log等级调整至INFO等级, 在退出控制台时生效\n"
    },
    {
        alias: "warning",
        exec: function () {
            global.logLevel = "WARNING";
            return "全局log等级调整至WARNING等级\n" + global.currentMenu;
        },
        help: "warning\n" +
            "\t将全局log等级调整至WARNING等级, 在退出控制台时生效\n"
    },
    {
        alias: "error",
        exec: function () {
            global.logLevel = "ERROR";
            return "全局log等级调整至ERROR等级\n" + global.currentMenu;
        },
        help: "error\n" +
            "\t将全局log等级调整至ERROR等级, 在退出控制台时生效\n"
    },
    back,
    quit
];
const RoomNodes = [
    {
        alias: "chooseRoom",
        exec: function () {
            let menu = "选择房间:\n";
            let i = 0;
            let ChooseRoomNodes = [];
            for (const roomName in Game.rooms) {
                const room = Game.rooms[roomName];
                menu += `> r${i} ${room} Level${room.find(FIND_MY_STRUCTURES, { filter: { structureType: STRUCTURE_CONTROLLER } })[0].level}\n`;
                ChooseRoomNodes.push({
                    alias: `r${i}`,
                    exec: function () {
                        global.currentRoom = room;
                        return `${roomName} is chosen\n` + back.exec();
                    },
                    help: getRoomInfo(room)
                });
            }
            menu += "> back\t\t\t\t返回上一级菜单\n";
            ChooseRoomNodes.push(back);
            NextMenu("chooseRoom", menu, ChooseRoomNodes);
            return menu;
        },
        help: "chooseRoom\n" +
            "\t选择目前已经拥有的房间\n"
    },
    {
        alias: "autoPlan",
        exec: function () {
            if (!global.currentRoom) {
                return "> 请先指定房间\n";
            }
            const menu = "自动规划选项:\n" +
                "> RoomPlan\t\t\t\t简单测试\n" +
                "> back\t\t\t\t返回上一级菜单\n" +
                "> quit\t\t\t\t退出控制台\n";
            NextMenu("autoPlan", menu, autoPlanNodes);
            return menu;
        },
        help: "autoPlan\n" +
            "\t写的一个简单的自动规划\n"
    },
    {
        alias: "memoryInfo",
        exec: function () {
            var _a;
            if (!global.currentRoom) {
                return "> 请先指定房间\n";
            }
            let txt = "";
            txt += "> spawnTask:\n\t";
            const spawnBuckets = global.currentRoom.normalizeTaskBuckets('spawnTask');
            if (spawnBuckets) {
                const keys = Object.keys(spawnBuckets).map(Number).sort((a, b) => a - b);
                for (const key of keys) {
                    const bucket = spawnBuckets[String(key)];
                    if (!bucket || !bucket.length) {
                        continue;
                    }
                    bucket.forEach((item) => {
                        var _a;
                        txt += ((_a = item === null || item === void 0 ? void 0 : item.taskParam) === null || _a === void 0 ? void 0 : _a[0]) + " ";
                    });
                }
            }
            txt += "\n\n";
            txt += "> creepTask:\n";
            const TaskType = ['workTask',
                'harvestTask',
                'carryTask',
                'upgradeTask',
                "constructTask",
                'energyTask',
                'spawnTask'];
            for (const type of TaskType) {
                const buckets = global.currentRoom.normalizeTaskBuckets(type);
                let size = 0;
                if (buckets) {
                    for (const key in buckets) {
                        size += ((_a = buckets[key]) === null || _a === void 0 ? void 0 : _a.length) || 0;
                    }
                }
                txt += "\t" + type + ": " + size + "\n";
                // global.room[global.currentRoom.name].creepTask[type].forEach((item: TaskEntity) => {
                //     txt += item.taskParam
                // })
            }
            return txt + "\n" + global.currentMenu;
        },
        help: "memoryInfo\n" +
            "\t房间中挂载在memory上的信息\n"
    },
    back,
    quit
];
const autoPlanNodes = [
    {
        alias: "RoomPlan",
        exec: function () {
            const room = global.currentRoom;
            if (!room.memory.plan1Pos) {
                room.calPerfectBasePos();
            }
            room.showRoomPlan();
            return "OK";
        },
        help: "init\n" +
            "\t这个函数还没有写\n"
    },
    back,
    quit
];
function getRoomInfo(room = global.currentRoom) {
    return ``;
}
function NextMenu(alias, menu, node) {
    UnloadFunction();
    global.cmdList.push(alias);
    LoadFunction(node);
    global.currentMenu = "\n" + menu;
}
function LoadFunction(NodeList) {
    global.nodeList.push(NodeList);
    global.aliasList = [];
    global.helpText = "";
    NodeList.forEach(node => {
        global.aliasList.push(node.alias);
        global.helpText += node.help;
        Object.defineProperty(global, node.alias, { configurable: true, get: node.exec });
    });
}
function UnloadFunction() {
    global.aliasList.forEach(alias => {
        delete global[alias];
    });
    delete global.helpText;
    delete global.aliasList;
}

var extension = {
// /**
//  * 全局刷新, 包括
//  */
// creepRecycle() {
//     const currentTimestamp = Game.time;
//     // 检查上次调用时间
//     const lastRecycleTimestamp = global.lastRecycleTime
//     if (currentTimestamp === lastRecycleTimestamp) {
//         // 如果当前时间与上次调用时间相同，说明已经在本 tick 内调用过 recycle 函数，直接返回
//         return;
//     }
//     for (let creepName in Memory.creeps) {
//         if (!Game.creeps[creepName]) {
//             const memory = Memory.creeps[creepName]
//             const room = Game.rooms[memory.spawnRoom]
//             room.memory.creepTask[memory.currentWorkType].push(memory.currentWork)
//             room.addToSpawnList(memory.role)
//             delete Memory.creeps[creepName]
//         }
//     }
//     global.lastRecycleTime = currentTimestamp
// }
};

// 挂载全局拓展
function mountGlobal () {
    console.log("+ Mounting Global extension");
    // 挂载有别名的操作
    rootNodes.map(item => {
        Object.defineProperty(global, item.alias, { get: item.exec });
    });
    // 挂载没有别名的操作
    _.assign(global, extension);
}

function mountVisual () {
    const colors = {
        gray: '#555555',
        light: '#AAAAAA',
        road: '#666', // >:D
        energy: '#FFE87B',
        power: '#F53547',
        dark: '#181818',
        outline: '#8FBB93',
        speechText: '#000000',
        speechBackground: '#2ccf3b'
    };
    const speechSize = 0.5;
    const speechFont = 'Times New Roman';

    function calculateFactoryLevelGapsPoly() {
        let x = -0.08;
        let y = -0.52;
        let result = [];

        let gapAngle = 16 * (Math.PI / 180);
        let c1 = Math.cos(gapAngle);
        let s1 = Math.sin(gapAngle);

        let angle = 72 * (Math.PI / 180);
        let c2 = Math.cos(angle);
        let s2 = Math.sin(angle);

        for (let i = 0; i < 5; ++i) {
            result.push([0.0, 0.0]);
            result.push([x, y]);
            result.push([x * c1 - y * s1, x * s1 + y * c1]);
            let tmpX = x * c2 - y * s2;
            y = x * s2 + y * c2;
            x = tmpX;
        }
        return result;
    }

    const factoryLevelGaps = calculateFactoryLevelGapsPoly();

    RoomVisual.prototype.structure = function (x, y, type, opts = {}) {
        opts = Object.assign({
            opacity: 1
        }, opts);
        switch (type) {
            case STRUCTURE_FACTORY: {
                const outline = [
                    [-0.68, -0.11],
                    [-0.84, -0.18],
                    [-0.84, -0.32],
                    [-0.44, -0.44],
                    [-0.32, -0.84],
                    [-0.18, -0.84],
                    [-0.11, -0.68],

                    [0.11, -0.68],
                    [0.18, -0.84],
                    [0.32, -0.84],
                    [0.44, -0.44],
                    [0.84, -0.32],
                    [0.84, -0.18],
                    [0.68, -0.11],

                    [0.68, 0.11],
                    [0.84, 0.18],
                    [0.84, 0.32],
                    [0.44, 0.44],
                    [0.32, 0.84],
                    [0.18, 0.84],
                    [0.11, 0.68],

                    [-0.11, 0.68],
                    [-0.18, 0.84],
                    [-0.32, 0.84],
                    [-0.44, 0.44],
                    [-0.84, 0.32],
                    [-0.84, 0.18],
                    [-0.68, 0.11]
                ];
                this.poly(outline.map(p => [p[0] + x, p[1] + y]), {
                    fill: null,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                // outer circle
                this.circle(x, y, {
                    radius: 0.65,
                    fill: '#232323',
                    strokeWidth: 0.035,
                    stroke: '#140a0a',
                    opacity: opts.opacity
                });
                const spikes = [
                    [-0.4, -0.1],
                    [-0.8, -0.2],
                    [-0.8, -0.3],
                    [-0.4, -0.4],
                    [-0.3, -0.8],
                    [-0.2, -0.8],
                    [-0.1, -0.4],

                    [0.1, -0.4],
                    [0.2, -0.8],
                    [0.3, -0.8],
                    [0.4, -0.4],
                    [0.8, -0.3],
                    [0.8, -0.2],
                    [0.4, -0.1],

                    [0.4, 0.1],
                    [0.8, 0.2],
                    [0.8, 0.3],
                    [0.4, 0.4],
                    [0.3, 0.8],
                    [0.2, 0.8],
                    [0.1, 0.4],

                    [-0.1, 0.4],
                    [-0.2, 0.8],
                    [-0.3, 0.8],
                    [-0.4, 0.4],
                    [-0.8, 0.3],
                    [-0.8, 0.2],
                    [-0.4, 0.1]
                ];
                this.poly(spikes.map(p => [p[0] + x, p[1] + y]), {
                    fill: colors.gray,
                    stroke: '#140a0a',
                    strokeWidth: 0.04,
                    opacity: opts.opacity
                });
                // factory level circle
                this.circle(x, y, {
                    radius: 0.54,
                    fill: '#302a2a',
                    strokeWidth: 0.04,
                    stroke: '#140a0a',
                    opacity: opts.opacity
                });
                this.poly(factoryLevelGaps.map(p => [p[0] + x, p[1] + y]), {
                    fill: '#140a0a',
                    stroke: null,
                    opacity: opts.opacity
                });
                // inner black circle
                this.circle(x, y, {
                    radius: 0.42,
                    fill: '#140a0a',
                    opacity: opts.opacity
                });
                this.rect(x - 0.24, y - 0.24, 0.48, 0.48, {
                    fill: '#3f3f3f',
                    opacity: opts.opacity
                });
                break;
            }
            case STRUCTURE_EXTENSION:
                this.circle(x, y, {
                    radius: 0.5,
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                this.circle(x, y, {
                    radius: 0.35,
                    fill: colors.gray,
                    opacity: opts.opacity
                });
                break;
            case STRUCTURE_SPAWN:
                this.circle(x, y, {
                    radius: 0.65,
                    fill: colors.dark,
                    stroke: '#CCCCCC',
                    strokeWidth: 0.10,
                    opacity: opts.opacity
                });
                this.circle(x, y, {
                    radius: 0.40,
                    fill: colors.energy,
                    opacity: opts.opacity
                });

                break;
            case STRUCTURE_POWER_SPAWN:
                this.circle(x, y, {
                    radius: 0.65,
                    fill: colors.dark,
                    stroke: colors.power,
                    strokeWidth: 0.10,
                    opacity: opts.opacity
                });
                this.circle(x, y, {
                    radius: 0.40,
                    fill: colors.energy,
                    opacity: opts.opacity
                });
                break;
            case STRUCTURE_LINK: {
                let outer = [
                    [0.0, -0.5],
                    [0.4, 0.0],
                    [0.0, 0.5],
                    [-0.4, 0.0]
                ];
                let inner = [
                    [0.0, -0.3],
                    [0.25, 0.0],
                    [0.0, 0.3],
                    [-0.25, 0.0]
                ];
                outer = relPoly(x, y, outer);
                inner = relPoly(x, y, inner);
                outer.push(outer[0]);
                inner.push(inner[0]);
                this.poly(outer, {
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                this.poly(inner, {
                    fill: colors.gray,
                    stroke: false,
                    opacity: opts.opacity
                });
                break;
            }
            case STRUCTURE_TERMINAL: {
                let outer = [
                    [0.0, -0.8],
                    [0.55, -0.55],
                    [0.8, 0.0],
                    [0.55, 0.55],
                    [0.0, 0.8],
                    [-0.55, 0.55],
                    [-0.8, 0.0],
                    [-0.55, -0.55],
                ];
                let inner = [
                    [0.0, -0.65],
                    [0.45, -0.45],
                    [0.65, 0.0],
                    [0.45, 0.45],
                    [0.0, 0.65],
                    [-0.45, 0.45],
                    [-0.65, 0.0],
                    [-0.45, -0.45],
                ];
                outer = relPoly(x, y, outer);
                inner = relPoly(x, y, inner);
                outer.push(outer[0]);
                inner.push(inner[0]);
                this.poly(outer, {
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                this.poly(inner, {
                    fill: colors.light,
                    stroke: false,
                    opacity: opts.opacity
                });
                this.rect(x - 0.45, y - 0.45, 0.9, 0.9, {
                    fill: colors.gray,
                    stroke: colors.dark,
                    strokeWidth: 0.1,
                    opacity: opts.opacity
                });
                break;
            }
            case STRUCTURE_LAB:
                this.circle(x, y - 0.025, {
                    radius: 0.55,
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                this.circle(x, y - 0.025, {
                    radius: 0.40,
                    fill: colors.gray,
                    opacity: opts.opacity
                });
                this.rect(x - 0.45, y + 0.3, 0.9, 0.25, {
                    fill: colors.dark,
                    stroke: false,
                    opacity: opts.opacity
                });
            {
                let box = [
                    [-0.45, 0.3],
                    [-0.45, 0.55],
                    [0.45, 0.55],
                    [0.45, 0.3],
                ];
                box = relPoly(x, y, box);
                this.poly(box, {
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
            }
                break;
            case STRUCTURE_TOWER:
                this.circle(x, y, {
                    radius: 0.6,
                    fill: colors.dark,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                this.rect(x - 0.4, y - 0.3, 0.8, 0.6, {
                    fill: colors.gray,
                    opacity: opts.opacity
                });
                this.rect(x - 0.2, y - 0.9, 0.4, 0.5, {
                    fill: colors.light,
                    stroke: colors.dark,
                    strokeWidth: 0.07,
                    opacity: opts.opacity
                });
                break;
            case STRUCTURE_ROAD:
                this.circle(x, y, {
                    radius: 0.175,
                    fill: colors.road,
                    stroke: false,
                    opacity: opts.opacity
                });
                if (!this.roads) this.roads = [];
                this.roads.push([x, y]);
                break;
            case STRUCTURE_RAMPART:
                this.circle(x, y, {
                    radius: 0.65,
                    fill: '#434C43',
                    stroke: '#5D735F',
                    strokeWidth: 0.10,
                    opacity: opts.opacity
                });
                break;
            case STRUCTURE_WALL:
                this.circle(x, y, {
                    radius: 0.40,
                    fill: colors.dark,
                    stroke: colors.light,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                break;
            case STRUCTURE_STORAGE:
                let outline1 = relPoly(x, y, [
                    [-0.45, -0.55],
                    [0, -0.65],
                    [0.45, -0.55],
                    [0.55, 0],
                    [0.45, 0.55],
                    [0, 0.65],
                    [-0.45, 0.55],
                    [-0.55, 0],
                    [-0.45, -0.55],
                ]);
                this.poly(outline1, {
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    fill: colors.dark,
                    opacity: opts.opacity
                });
                this.rect(x - 0.35, y - 0.45, 0.7, 0.9, {
                    fill: colors.energy,
                    opacity: opts.opacity,
                });
                break;
            case STRUCTURE_OBSERVER:
                this.circle(x, y, {
                    fill: colors.dark,
                    radius: 0.45,
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    opacity: opts.opacity
                });
                this.circle(x + 0.225, y, {
                    fill: colors.outline,
                    radius: 0.20,
                    opacity: opts.opacity
                });
                break;
            case STRUCTURE_NUKER:
                let outline = [
                    [0, -1],
                    [-0.47, 0.2],
                    [-0.5, 0.5],
                    [0.5, 0.5],
                    [0.47, 0.2],
                    [0, -1],
                ];
                outline = relPoly(x, y, outline);
                this.poly(outline, {
                    stroke: colors.outline,
                    strokeWidth: 0.05,
                    fill: colors.dark,
                    opacity: opts.opacity
                });
                let inline = [
                    [0, -.80],
                    [-0.40, 0.2],
                    [0.40, 0.2],
                    [0, -.80],
                ];
                inline = relPoly(x, y, inline);
                this.poly(inline, {
                    stroke: colors.outline,
                    strokeWidth: 0.01,
                    fill: colors.gray,
                    opacity: opts.opacity
                });
                break;
            case STRUCTURE_CONTAINER:
                this.rect(x - 0.225, y - 0.3, 0.45, 0.6, {
                    fill: colors.gray,
                    opacity: opts.opacity,
                    stroke: colors.dark,
                    strokeWidth: 0.09,
                });
                this.rect(x - 0.17, y + 0.07, 0.34, 0.2, {
                    fill: colors.energy,
                    opacity: opts.opacity,
                });
                break;
            case "Null":
                break;
            default:
                this.circle(x, y, {
                    fill: colors.light,
                    radius: 0.35,
                    stroke: colors.dark,
                    strokeWidth: 0.20,
                    opacity: opts.opacity
                });
                break;
        }

        return this;
    };

    const dirs = [
        [],
        [0, -1],
        [1, -1],
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [-1, -1]
    ];

    RoomVisual.prototype.connectRoads = function (opts = {}) {
        let color = opts.color || colors.road || 'white';
        if (!this.roads) return;
        this.roads.forEach(r => {
            for (let i = 1; i <= 4; i++) {
                let d = dirs[i];
                let c = [r[0] + d[0], r[1] + d[1]];
                let rd = _.some(this.roads, r => r[0] === c[0] && r[1] === c[1]);
                if (rd) {
                    this.line(r[0], r[1], c[0], c[1], {
                        color: color,
                        width: 0.35,
                        opacity: opts.opacity || 1
                    });
                }
            }
        });

        return this;
    };


    RoomVisual.prototype.speech = function (text, x, y, opts = {}) {
        var background = !!opts.background ? opts.background : colors.speechBackground;
        var textcolor = !!opts.textcolor ? opts.textcolor : colors.speechText;
        var textstyle = !!opts.textstyle ? opts.textstyle : false;
        var textsize = !!opts.textsize ? opts.textsize : speechSize;
        var textfont = !!opts.textfont ? opts.textfont : speechFont;
        var opacity = !!opts.opacity ? opts.opacity : 1;

        var fontstring = '';
        if (textstyle) {
            fontstring = textstyle + ' ';
        }
        fontstring += textsize + ' ' + textfont;

        let pointer = [
            [-0.2, -0.8],
            [0.2, -0.8],
            [0, -0.3]
        ];
        pointer = relPoly(x, y, pointer);
        pointer.push(pointer[0]);

        this.poly(pointer, {
            fill: background,
            stroke: background,
            opacity: opacity,
            strokeWidth: 0.0
        });

        this.text(text, x, y - 1, {
            color: textcolor,
            backgroundColor: background,
            backgroundPadding: 0.1,
            opacity: opacity,
            font: fontstring
        });

        return this;
    };


    RoomVisual.prototype.animatedPosition = function (x, y, opts = {}) {

        let color = !!opts.color ? opts.color : 'blue';
        let opacity = !!opts.opacity ? opts.opacity : 0.5;
        let radius = !!opts.radius ? opts.radius : 0.75;
        let frames = !!opts.frames ? opts.frames : 6;


        let angle = (Game.time % frames * 90 / frames) * (Math.PI / 180);
        let s = Math.sin(angle);
        let c = Math.cos(angle);

        let sizeMod = Math.abs(Game.time % frames - frames / 2) / 10;
        radius += radius * sizeMod;

        let points = [
            rotate(0, -radius, s, c, x, y),
            rotate(radius, 0, s, c, x, y),
            rotate(0, radius, s, c, x, y),
            rotate(-radius, 0, s, c, x, y),
            rotate(0, -radius, s, c, x, y),
        ];

        this.poly(points, {stroke: color, opacity: opacity});

        return this;
    };

    function rotate(x, y, s, c, px, py) {
        let xDelta = x * c - y * s;
        let yDelta = x * s + y * c;
        return {x: px + xDelta, y: py + yDelta};
    }


    function relPoly(x, y, poly) {
        return poly.map(p => {
            p[0] += x;
            p[1] += y;
            return p
        })
    }


/// #region RESOURCE BADGES
    const ColorSets = {
        white: ["#ffffff", "#4c4c4c"],
        grey: ["#b4b4b4", "#4c4c4c"],
        red: ["#ff7b7b", "#592121"],
        yellow: ["#fdd388", "#5d4c2e"],
        green: ["#00f4a2", "#236144"],
        blue: ["#50d7f9", "#006181"],
        purple: ["#a071ff", "#371383"],
    };
    const ResourceColors = {
        [RESOURCE_ENERGY]: ColorSets.yellow,
        [RESOURCE_POWER]: ColorSets.red,

        [RESOURCE_HYDROGEN]: ColorSets.grey,
        [RESOURCE_OXYGEN]: ColorSets.grey,
        [RESOURCE_UTRIUM]: ColorSets.blue,
        [RESOURCE_LEMERGIUM]: ColorSets.green,
        [RESOURCE_KEANIUM]: ColorSets.purple,
        [RESOURCE_ZYNTHIUM]: ColorSets.yellow,
        [RESOURCE_CATALYST]: ColorSets.red,
        [RESOURCE_GHODIUM]: ColorSets.white,

        [RESOURCE_HYDROXIDE]: ColorSets.grey,
        [RESOURCE_ZYNTHIUM_KEANITE]: ColorSets.grey,
        [RESOURCE_UTRIUM_LEMERGITE]: ColorSets.grey,

        [RESOURCE_UTRIUM_HYDRIDE]: ColorSets.blue,
        [RESOURCE_UTRIUM_OXIDE]: ColorSets.blue,
        [RESOURCE_KEANIUM_HYDRIDE]: ColorSets.purple,
        [RESOURCE_KEANIUM_OXIDE]: ColorSets.purple,
        [RESOURCE_LEMERGIUM_HYDRIDE]: ColorSets.green,
        [RESOURCE_LEMERGIUM_OXIDE]: ColorSets.green,
        [RESOURCE_ZYNTHIUM_HYDRIDE]: ColorSets.yellow,
        [RESOURCE_ZYNTHIUM_OXIDE]: ColorSets.yellow,
        [RESOURCE_GHODIUM_HYDRIDE]: ColorSets.white,
        [RESOURCE_GHODIUM_OXIDE]: ColorSets.white,

        [RESOURCE_UTRIUM_ACID]: ColorSets.blue,
        [RESOURCE_UTRIUM_ALKALIDE]: ColorSets.blue,
        [RESOURCE_KEANIUM_ACID]: ColorSets.purple,
        [RESOURCE_KEANIUM_ALKALIDE]: ColorSets.purple,
        [RESOURCE_LEMERGIUM_ACID]: ColorSets.green,
        [RESOURCE_LEMERGIUM_ALKALIDE]: ColorSets.green,
        [RESOURCE_ZYNTHIUM_ACID]: ColorSets.yellow,
        [RESOURCE_ZYNTHIUM_ALKALIDE]: ColorSets.yellow,
        [RESOURCE_GHODIUM_ACID]: ColorSets.white,
        [RESOURCE_GHODIUM_ALKALIDE]: ColorSets.white,

        [RESOURCE_CATALYZED_UTRIUM_ACID]: ColorSets.blue,
        [RESOURCE_CATALYZED_UTRIUM_ALKALIDE]: ColorSets.blue,
        [RESOURCE_CATALYZED_KEANIUM_ACID]: ColorSets.purple,
        [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: ColorSets.purple,
        [RESOURCE_CATALYZED_LEMERGIUM_ACID]: ColorSets.green,
        [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: ColorSets.green,
        [RESOURCE_CATALYZED_ZYNTHIUM_ACID]: ColorSets.yellow,
        [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: ColorSets.yellow,
        [RESOURCE_CATALYZED_GHODIUM_ACID]: ColorSets.white,
        [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: ColorSets.white,
    };

    const MINERALS = [
        RESOURCE_CATALYST,
        RESOURCE_HYDROGEN,
        RESOURCE_OXYGEN,
        RESOURCE_LEMERGIUM,
        RESOURCE_UTRIUM,
        RESOURCE_ZYNTHIUM,
        RESOURCE_KEANIUM
    ];

    RoomVisual.prototype.resource = function (type, x, y, size = 0.25) {
        if (type === RESOURCE_ENERGY || type === RESOURCE_POWER)
            this._fluid(type, x, y, size);
        else if (MINERALS.includes(type))
            this._mineral(type, x, y, size);
        else if (ResourceColors[type] !== undefined)
            this._compound(type, x, y, size);
        else
            return ERR_INVALID_ARGS;
        return OK;
    };
    RoomVisual.prototype._fluid = function (type, x, y, size = 0.25) {
        this.circle(x, y, {
            radius: size,
            fill: ResourceColors[type][0],
            opacity: 1,
        });
        this.text(type[0], x, y - (size * 0.1), {
            font: (size * 1.5),
            color: ResourceColors[type][1],
            backgroundColor: ResourceColors[type][0],
            backgroundPadding: 0,
        });
    };
    RoomVisual.prototype._mineral = function (type, x, y, size = 0.25) {
        this.circle(x, y, {
            radius: size,
            fill: ResourceColors[type][0],
            opacity: 1,
        });
        this.circle(x, y, {
            radius: size * 0.8,
            fill: ResourceColors[type][1],
            opacity: 1,
        });
        this.text(type, x, y + (size * 0.03), {
            font: "bold " + (size * 1.25) + " arial",
            color: ResourceColors[type][0],
            backgroundColor: ResourceColors[type][1],
            backgroundPadding: 0,
        });
    };
    RoomVisual.prototype._compound = function (type, x, y, size = 0.25) {
        let label = type.replace("2", '₂');

        this.text(label, x, y, {
            font: "bold " + (size * 1) + " arial",
            color: ResourceColors[type][1],
            backgroundColor: ResourceColors[type][0],
            backgroundPadding: 0.3 * size,
        });
    };
/// #endregion
}

function mount () {
    // console.log(global.hasExtension)
    if (!global.hasExtension) {
        console.log("[mount] 重新挂载");
        mountCreep();
        mountStructure();
        mountRoom();
        mountGlobal();
        mountVisual();
        globalInit();
        global.hasExtension = true;
    }
}
function globalInit() {
    global.room = {};
    delete Memory.rooms;
    for (const roomName in Game.rooms) {
        Game.rooms[roomName].init();
    }
}

/**
 * 全局统计信息扫描器
 * 负责搜集关于 cpu、memory、GCL、GPL 的相关信息
 */
const stateScanner = function () {
    // 每 20 tick 运行一次
    if (Game.time % 20)
        return;
    if (!Memory.stats)
        Memory.stats = {};
    // 统计 GCL / GPL 的升级百分比和等级
    Memory.stats.gcl = (Game.gcl.progress / Game.gcl.progressTotal) * 100;
    Memory.stats.gclLevel = Game.gcl.level;
    Memory.stats.gpl = (Game.gpl.progress / Game.gpl.progressTotal) * 100;
    Memory.stats.gplLevel = Game.gpl.level;
    // CPU 的当前使用量
    Memory.stats.cpu = Game.cpu.getUsed();
    // bucket 当前剩余量
    Memory.stats.bucket = Game.cpu.bucket;
    Memory.stats.pixel = Game.resources['pixel'];
    // for (const room in Game.rooms) {
    //     if (Game.rooms[room].controller.my) {
    //         Memory.stats.room[room] = {
    //             dataPool: Game.rooms[room].memory.dataPool,
    //             availableEnergy: Game.rooms[room].energyAvailable
    //         }
    //     }
    // }
};

const loop = errorMapper(() => {
    mount();
    loggerInstance.warning("+----------------------------" + Game.time + "------------------------------+");
    stateScanner();
    // if (!(Game.time % 30)) {
    //     creepRecycle()
    // }
    scanControl();
    structureControl();
    creepControl();
    roomControl();
    //generatePixel()
    for (const room in Game.rooms) {
        // getBiggestSquare(11, room)
        // visualize(totalCluster1, room, 15, 12, Game.time % 9)
        // Game.rooms[room].calDistance(9, 17)
        // Game.rooms[room].getBiggestSquare(11)
        // const [x, y] = Game.rooms[room].calPerfectBasePos()
        // // console.log(x, y)
        // Game.rooms[room].visualize(totalCluster1, x, y)
    }
    debugDump();
});
function roomControl() {
    var _a;
    for (const room in Game.rooms) {
        const currentRoom = Game.rooms[room];
        const isOwned = !!((_a = currentRoom.controller) === null || _a === void 0 ? void 0 : _a.my);
        if (!global.room[room] || (isOwned && !currentRoom.memory.creepTask)) {
            Game.rooms[room].init();
        }
        // Game.rooms[room].registEvent(testEvent(Game.rooms[room]))
        Game.rooms[room].runEvent();
        // Game.rooms[room].calSourceMap()
    }
}
/**
 * 先扫描房间环境，保证同 tick 内的塔读到的是最新缓存
 */
function scanControl() {
    for (const roomName in Game.rooms) {
        Game.rooms[roomName].scan();
    }
}
function structureControl() {
    for (let structureId in Game.structures) {
        const structure = Game.getObjectById(structureId);
        if (typeof structure.work == "function") {
            structure.work();
        }
    }
}
function creepControl() {
    for (let creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        creep.work();
    }
}
function debugDump() {
    var _a;
    // if (!global.debug) {
    //     return
    // }
    const lines = [];
    lines.push(`DEBUG ${Game.time}`);
    if (!global.room) {
        loggerInstance.debug(lines.join("\n"));
        return;
    }
    for (const roomName in global.room) {
        const roomData = global.room[roomName];
        if (!roomData) {
            continue;
        }
        lines.push(`room:${roomName}`);
        const room = Game.rooms[roomName];
        if (!room) {
            continue;
        }
        const energyList = room.energyStructureOrder();
        if (energyList && energyList.length) {
            const sample = energyList.slice(0, 6).map(id => {
                var _a;
                const s = Game.getObjectById(id);
                if (!s) {
                    return "null";
                }
                const type = s.structureType;
                const free = (_a = s.store) === null || _a === void 0 ? void 0 : _a.getFreeCapacity(RESOURCE_ENERGY);
                return `${type}:${free}`;
            }).join(",");
            lines.push(`energyList:${energyList.length}:${sample}`);
        }
        const timer = room.memory.timer;
        if (timer) {
            const ticks = Object.keys(timer).map(Number).sort((a, b) => a - b);
            if (ticks.length) {
                const eventSamples = [];
                let eventCount = 0;
                for (const tick of ticks) {
                    const events = timer[tick];
                    if (!events || !events.length) {
                        continue;
                    }
                    eventCount += events.length;
                    if (eventSamples.length < 3) {
                        for (const item of events) {
                            if (!item) {
                                continue;
                            }
                            const func = (_a = item[0]) !== null && _a !== void 0 ? _a : "unknown";
                            eventSamples.push(`${func}@${tick}`);
                            if (eventSamples.length >= 3) {
                                break;
                            }
                        }
                    }
                }
                if (eventCount) {
                    lines.push(`event:${eventCount}:${eventSamples.join(";")}`);
                }
            }
        }
        const spawnBuckets = room.normalizeTaskBuckets('spawnTask');
        if (spawnBuckets) {
            const roles = [];
            const keys = Object.keys(spawnBuckets).map(Number).sort((a, b) => a - b);
            for (const key of keys) {
                const bucket = spawnBuckets[String(key)];
                if (!bucket || !bucket.length) {
                    continue;
                }
                roles.push(...bucket.map(item => { var _a; return (_a = item === null || item === void 0 ? void 0 : item.taskParam) === null || _a === void 0 ? void 0 : _a[0]; }).filter(Boolean));
            }
            if (roles.length) {
                lines.push(`spawnTask:${roles.join(",")}`);
            }
        }
        const creepTask = room.memory.creepTask;
        if (creepTask) {
            for (const taskType in creepTask) {
                const buckets = room.normalizeTaskBuckets(taskType);
                let size = 0;
                let detail = "";
                const sampleTasks = [];
                for (const key in buckets) {
                    const bucket = buckets[key];
                    if (!bucket || !bucket.length) {
                        continue;
                    }
                    size += bucket.length;
                    if (sampleTasks.length < 3) {
                        sampleTasks.push(...bucket.slice(0, 3 - sampleTasks.length));
                    }
                }
                if (size) {
                    const sample = sampleTasks.map(task => {
                        var _a;
                        if (!task) {
                            return "null";
                        }
                        const reserved = task.reservedBy ? task.reservedBy.map(item => item.name).join(" | ") : "";
                        const capacity = (_a = task.capacity) !== null && _a !== void 0 ? _a : 1;
                        return `${task.taskFunc}@cap${capacity}@res[${reserved}]`;
                    }).join(";");
                    detail = `:${sample}`;
                }
                lines.push(`task:${taskType} = ${size}${detail}`);
            }
        }
    }
    loggerInstance.debug(lines.join("\n"));
}

exports.loop = loop;
//# sourceMappingURL=main.js.map
