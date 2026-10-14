// The S4 row table, kept as two JSON files so neither runs past 400 lines.
// Key = test file name; value = the control rows that file proves.

import MONEY from "./s4-rows-money.json" with { type: "json" };
import SCREENS from "./s4-rows-screens.json" with { type: "json" };

export const S4_ROWS = Object.freeze({ ...MONEY, ...SCREENS });
