const fs = require("fs");
const vm = require("vm");

const parserSource = fs.readFileSync("parser.js", "utf8");
const context = {};

vm.createContext(context);
vm.runInContext(parserSource, context);

const sample = [
  "12/03/24 GROCERY STORE 1,250.00 8,750.00 10,000.00",
  "13/03/24 SALARY CREDIT 5,000.00 13,750.00 8,750.00",
  "14/03/24 UPI PAYMENT TO SHOP 450.00 13,300.00",
  "15/03/24 ATM CASH WDL 2,000.00 11,300.00",
  "Mar 15, 2026 07:50 pm Paid to YOUR S UNIVERSE BAKES AND CAKES DEBIT ₹120",
  "Mar 09, 2026 05:58 pm Received from ROMAN SHARMA CREDIT ₹27,400"
].join("\n");

const expected = [
  { date: "12/03/24", debit: 1250, credit: "" },
  { date: "13/03/24", debit: "", credit: 5000 },
  { date: "14/03/24", debit: 450, credit: "" },
  { date: "15/03/24", debit: 2000, credit: "" },
  { date: "Mar 15, 2026", debit: 120, credit: "" },
  { date: "Mar 09, 2026", debit: "", credit: 27400 }
];

const actual = context.detectAndParse(sample);

expected.forEach((row, index) => {
  const candidate = actual[index];

  if (
    !candidate ||
    candidate.date !== row.date ||
    candidate.debit !== row.debit ||
    candidate.credit !== row.credit
  ) {
    throw new Error(
      `Row ${index + 1} mismatch.\nExpected: ${JSON.stringify(row)}\nActual: ${JSON.stringify(candidate)}`
    );
  }
});

console.log(`Parser smoke test passed for ${actual.length} records.`);
