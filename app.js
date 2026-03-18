const STORAGE_KEY = "expenseTrackerTransactions";
const MANUAL_IMPORT_STORAGE_KEY = "expenseTrackerManualImportText";

document.getElementById("scanBtn").onclick = async () => {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  const status = document.getElementById("status");

  if (!file) {
    status.textContent = "Please upload an image or PDF before scanning.";
    return;
  }

  try {
    status.textContent = "Extracting text from your file...";

    const text =
      file.type === "application/pdf"
        ? await extractTextFromPDF(file)
        : await extractTextFromImage(file);

    status.textContent = "Parsing transactions...";

    const existingTransactions = loadStoredTransactions();
    const scannedTransactions = detectAndParse(text).map(transaction =>
      createTransactionRecord(transaction, file.name)
    );

    if (!scannedTransactions.length) {
      localStorage.setItem(MANUAL_IMPORT_STORAGE_KEY, text);
      status.textContent =
        "No transactions were detected automatically. Opening manual import so you can map the OCR text.";
      window.location.href = "expense-tracker.html?tab=manualImport";
      return;
    }

    const transactions = [...existingTransactions, ...scannedTransactions];

    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));

    status.textContent =
      `Parsed ${scannedTransactions.length} new record(s). ` +
      `${transactions.length} total record(s) saved. Opening expense tracker...`;
    window.location.href = "expense-tracker.html";
  } catch (error) {
    status.textContent = "Scanning failed. Please try a clearer file.";
    console.error(error);
  }
};

function loadStoredTransactions() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw).map(transaction => createTransactionRecord(transaction));
  } catch (error) {
    console.error("Failed to load stored transactions", error);
    return [];
  }
}

function createTransactionRecord(transaction = {}, sourceFile = "") {
  return {
    date: transaction.date || "",
    description: transaction.description || "",
    debit: transaction.debit || "",
    credit: transaction.credit || "",
    category: transaction.category || "",
    subCategory: transaction.subCategory || "",
    group: transaction.group || "",
    sourceFile: transaction.sourceFile || sourceFile || "",
    importedAt: transaction.importedAt || new Date().toISOString()
  };
}

async function extractTextFromImage(file) {
  const res = await Tesseract.recognize(file, "eng");
  return res.data.text;
}

async function extractTextFromPDF(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }

  return text;
}
