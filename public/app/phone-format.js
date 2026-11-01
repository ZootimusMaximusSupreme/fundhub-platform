/* Phone labels only. Keep saved values and call/text targets unchanged. */
(function (root) {
  root.FHFormatPhone = function (value) {
    var raw = String(value == null ? "" : value).trim();
    var match = raw.match(/^(\+?[\d\s().-]+?)(\s*(?:ext\.?|x|;ext=)\s*\d+)?$/i);
    if (!match) return raw;
    var number = match[1].trim();
    if (number.charAt(0) === "+" && number.slice(0, 2) !== "+1") return raw;
    var digits = number.replace(/\D/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
    if (digits.length !== 10) return raw;
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6) + (match[2] || "");
  };
})(window);
