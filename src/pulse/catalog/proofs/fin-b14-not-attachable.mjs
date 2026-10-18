// The batch 14 display rows that cannot honestly be attached today, and exactly why.
// Each one is a finding, not a failure. Three lender controls still give a wrong result today, on the
// page as it is shipped. A test that passed them would have to pass the wrong result, and a test that asked
// for the right result would be red.
//
// fin-b14-rows.test.mjs holds every reason to the repo: it reads the source line each reason rests on, and the
// moment that line changes it goes red and says the row can now be attached. A test named KNOWN BREAK in
// fin-b14-lenders.test.mjs pins what the page does today
// (it runs in a real browser with fake answers), so a fixed page also turns that test red. The rest of each
// control is exercised in the same files and passes; only the wrong result keeps the row out.

export const FIN_B14_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "lenders.html",
    control: "AI bureau config: Add bureau row button (adds an empty editable row)",
    why: "The button adds one empty, Active row, sends nothing and does not read the config again, and that passes "
      + "(fin-b14-lenders.test.mjs). The wrong result is what it does to the other rows. It pushes a blank row onto the stored "
      + "list and draws the whole table again from that list (`bureauRows.push({...}); renderBureau();`), so anything typed into "
      + "a saved row and not yet saved is replaced by the saved value. Measured in a real browser run ('KNOWN BREAK ... Add bureau "
      + "row'): type a new menu path into the Experian row, press Add bureau row, and the box is back to the saved path. "
      + "The same goes for every row that has been typed in and not saved when Add is pressed, so adding the three bureau "
      + "rows one after the other loses the typing in the ones before. Fix: read the boxes back "
      + "into the list before it is drawn again. Then this row attaches.",
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "lenders.html",
    control: "Export CSV button (downloads lenders.csv for the current filters)",
    why: "A good export passes end to end: the boxes as they are now, no Apply needed, the file name, the exact csv the server sends, "
      + "the same rows the list returns, and no sample lender (fin-b14-lenders.test.mjs and fin-b14-lenders-sql.test.mjs). The "
      + "wrong result is a refused export. The page never looks at the status or the words of the answer "
      + "(`.then(function (r) { return r.text(); }).then(function (csv) { ... a.download = \"lenders.csv\"`), so when the server "
      + "says no (the session ended, a role that is not allowed) the file lenders.csv is saved anyway and holds the error "
      + "text. Measured in a real browser run ('KNOWN BREAK ... Export CSV'): a 403 answer is saved as lenders.csv holding "
      + "{\"ok\":false,\"error\":\"forbidden\"}, and no words are shown on the page. Fix: check the answer and say why. "
      + "Then this row attaches.",
  }),
  Object.freeze({
    sourceFile: "desks-c.json",
    surface: "lenders.html",
    control: "Lender row Save button (writes the 7 fields, stamps last_updated_by)",
    why: "Save of a row passes end to end for every field (fin-b14-lenders.test.mjs and fin-b14-lenders-handlers.test.mjs): the "
      + "seven fields as typed, empty cells as nothing, the pressed row's id when there are several rows, the row redrawn from the "
      + "answer, who and when stamped, the company from the session. The wrong result is a cleared Name box. The page sends an "
      + "empty box as null (`patch[k] = v === \"\" ? null : v`). api/lenders.mjs refuses a blank name with "
      + "`String(patch.name).trim() === \"\"`, and String(null) is \"null\", so the guard does not fire and the UPDATE goes to the "
      + "database with name = null, which the NOT NULL column refuses: a raw 500 where the guard's own comment promises the words "
      + "'Name is required.' Each half is measured ('KNOWN BREAK' in fin-b14-lenders.test.mjs: the page sends null; in "
      + "fin-b14-lenders-handlers.test.mjs: the handler lets null through with status 200 and a null parameter). Fix: treat null as "
      + "blank in the handler (or send the empty string). Then this row attaches.",
  }),
]);
