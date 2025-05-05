
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { MultiComparisonResults, MultiComparisonInputs, formatScientific, formatDecimal, formatPercent } from "./calculations"; // Import necessary types and formatters


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper function to safely escape CSV fields
function escapeCSV(field: string | number | null | undefined): string {
    if (field === null || field === undefined) {
        return '';
    }
    const stringField = String(field);
    // Escape double quotes by doubling them and wrap the field in double quotes if it contains commas, double quotes, or newlines
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}

// Updated function to convert MultiComparisonResults to CSV string and trigger download
export function exportToCSV(
    reportData: MultiComparisonResults | null, // Expects the full report object
    inputData: FormValues, // Use FormValues type from disparity-calculator
    filename: string = 'statistical-report.csv'
) {
  if (!reportData) {
      throw new Error("No report data available to export.");
  }

  const csvRows: string[] = [];
  const groupNames = reportData.contingencySummary?.map(g => g.name) ?? [];

  // --- Input Parameters Section ---
  csvRows.push("Input Parameters");
  csvRows.push(`Significance Level (α),${escapeCSV(inputData.alpha)}`);
  csvRows.push(""); // Blank row

  // --- Categories Input Section ---
  csvRows.push("Input Categories (Groups)");
  csvRows.push("Category Name,# Experienced,# Not Experienced");
  inputData.groups.forEach(group => {
    csvRows.push(`${escapeCSV(group.name)},${escapeCSV(group.experienced)},${escapeCSV(group.notExperienced)}`);
  });
  csvRows.push(""); // Blank row

  // --- Contingency Table Summary Section ---
  if (reportData.contingencySummary && reportData.contingencySummary.length > 0) {
    csvRows.push("Contingency Table Summary");
    const summaryHeaders = [
      "Category",
      "# Did NOT Experience",
      "# Experienced",
      "Row Subtotal",
      "% Experienced"
    ];
    csvRows.push(summaryHeaders.join(','));

    reportData.contingencySummary.forEach(row => {
      const values = [
        escapeCSV(row.name),
        escapeCSV(row.notExperienced),
        escapeCSV(row.experienced),
        escapeCSV(row.rowTotal),
        escapeCSV(formatPercent(row.percentExperienced)) // Use formatter
      ];
      csvRows.push(values.join(','));
    });
    csvRows.push(""); // Blank row
  }

  // --- Overall Test Statistics Section ---
  if (reportData.overallStats) {
    const stats = reportData.overallStats;
    csvRows.push("Overall Test Results");
    csvRows.push(`Limit (Significance Level α),${escapeCSV(formatDecimal(stats.limitAlpha, 4))}`);
    csvRows.push(`Degrees of Freedom,${escapeCSV(stats.degreesOfFreedom)}`);
    csvRows.push(`# of Pairwise Comparisons,${escapeCSV(stats.numComparisons)}`);
    csvRows.push(""); // separator

    // Chi-square
    csvRows.push("Test,Statistic,P-Value,Interpretation");
    csvRows.push(
      `Chi-square,${escapeCSV(formatDecimal(stats.chiSquare.statistic))},${escapeCSV(formatScientific(stats.chiSquare.pValue))},${escapeCSV(stats.chiSquare.interpretation)}`
    );
    // Chi-square (Yates)
     csvRows.push(
       `Chi-square (Yates),${escapeCSV(formatDecimal(stats.chiSquareYates.statistic))},${escapeCSV(formatScientific(stats.chiSquareYates.pValue))},${escapeCSV(stats.chiSquareYates.interpretation)}`
     );
    // G-Test
    csvRows.push(
      `G-Test,${escapeCSV(formatDecimal(stats.gTest.statistic))},${escapeCSV(formatScientific(stats.gTest.pValue))},${escapeCSV(stats.gTest.interpretation)}`
    );
    csvRows.push(""); // Blank row
  }

  // --- Pairwise Comparisons Matrix Section ---
  if (reportData.pairwiseResultsMatrix && groupNames.length > 0) {
    csvRows.push("P-Values of Pairwise Chi-Square Comparisons with Bonferroni Correction");

    // Matrix Header Row
    const matrixHeader = ["", ...groupNames.map(name => escapeCSV(name))];
    csvRows.push(matrixHeader.join(','));

    // Matrix Data Rows
    groupNames.forEach(rowName => {
      const rowValues = [escapeCSV(rowName)];
      groupNames.forEach(colName => {
        const pValue = reportData.pairwiseResultsMatrix?.[rowName]?.[colName];
        // Format p-value or leave blank/NA if null/NaN or lower triangle
         const isEmptyCell = groupNames.indexOf(rowName) > groupNames.indexOf(colName);
         const formattedPValue = (pValue === null || isNaN(pValue as number) || isEmptyCell) ? "" : formatScientific(pValue as number);
        rowValues.push(escapeCSV(formattedPValue));
      });
      csvRows.push(rowValues.join(','));
    });
    csvRows.push(""); // Blank row
  }

   // --- Errors Section ---
    if (reportData.errors && reportData.errors.length > 0) {
        csvRows.push("Calculation Errors/Warnings");
        reportData.errors.forEach(err => csvRows.push(escapeCSV(err)));
        csvRows.push("");
    }


  const csvString = csvRows.join('\n');

  // --- Download Trigger ---
  const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else {
    console.error("CSV download not supported in this browser.");
    throw new Error("CSV download not supported.");
  }
}

// Re-declare types needed within this file if not imported implicitly or explicitly elsewhere
// (This might be needed depending on your TS config and how types flow)
interface GroupInput {
  name: string;
  experienced: number;
  notExperienced: number;
}

interface FormValues {
  alpha: number;
  groups: GroupInput[];
}

// Assuming formatters are imported or defined in calculations.ts and exported
declare function formatScientific(value: number | null | undefined, significantDigits?: number): string;
declare function formatDecimal(value: number | null | undefined, decimalPlaces?: number): string;
declare function formatPercent(value: number | null | undefined, decimalPlaces?: number): string;


