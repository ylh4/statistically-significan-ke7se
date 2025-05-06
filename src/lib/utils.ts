
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { MultiComparisonResults } from "./calculations";
import { formatScientific, formatDecimal, formatPercent } from "./calculations";

// Define the type expected by exportToCSV for the input part.
// It now includes 'total' instead of 'notExperienced'.
export interface ExportFormValues {
  alpha: number;
  groups: {
    name: string;
    experienced: number;
    total: number; // Changed from notExperienced to total
  }[];
}


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper function to safely escape CSV fields
function escapeCSV(field: string | number | null | undefined): string {
    if (field === null || field === undefined) {
        return '';
    }
    const stringField = String(field);
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}

// Updated function to convert MultiComparisonResults to CSV string and trigger download
export function exportToCSV(
    reportData: MultiComparisonResults | null,
    inputData: ExportFormValues, // Uses the updated ExportFormValues
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
  // Updated headers for input section
  csvRows.push("Category Name,# Experienced,# Total,# Did Not Experience (Calculated)");
  inputData.groups.forEach(group => {
    const notExperienced = group.total - group.experienced; // Calculate for export
    csvRows.push(`${escapeCSV(group.name)},${escapeCSV(group.experienced)},${escapeCSV(group.total)},${escapeCSV(notExperienced)}`);
  });
  csvRows.push(""); // Blank row

  // --- Contingency Table Summary Section ---
  if (reportData.contingencySummary && reportData.contingencySummary.length > 0 && reportData.totals) {
    csvRows.push("Contingency Table Summary");
    const summaryHeaders = [
      "Category",
      "Observed: # Did NOT Experience",
      "Observed: # Experienced",
      "Observed: Row Subtotal",
      "% Experienced",
      "Expected: # Did NOT Experience",
      "Expected: # Experienced",
      "Chi-Sq Contribution",
    ];
    csvRows.push(summaryHeaders.join(','));

    reportData.contingencySummary.forEach(row => {
      const values = [
        escapeCSV(row.name),
        escapeCSV(row.notExperienced),
        escapeCSV(row.experienced),
        escapeCSV(row.rowTotal),
        escapeCSV(formatPercent(row.percentExperienced)),
        escapeCSV(formatDecimal(row.expectedNotExperienced, 1)),
        escapeCSV(formatDecimal(row.expectedExperienced, 1)),
        escapeCSV(formatDecimal(row.chiSquareContribution, 3)),
      ];
      csvRows.push(values.join(','));
    });

     const totals = reportData.totals;
     const totalRow = [
        escapeCSV("Column Subtotal"),
        escapeCSV(totals.totalNotExperienced),
        escapeCSV(totals.totalExperienced),
        escapeCSV(totals.grandTotal),
        escapeCSV(totals.grandTotal > 0 ? formatPercent((totals.totalExperienced / totals.grandTotal) * 100) : 'N/A'),
        escapeCSV(formatDecimal(totals.totalExpectedNotExperienced, 1)),
        escapeCSV(formatDecimal(totals.totalExpectedExperienced, 1)),
        escapeCSV(formatDecimal(totals.totalChiSquareContributions, 3)),
     ];
     csvRows.push(totalRow.join(','));

    csvRows.push("");
  }

  // --- Overall Test Statistics Section ---
  if (reportData.overallStats) {
    const stats = reportData.overallStats;
    const alpha = stats.limitAlpha;
    csvRows.push("Overall Test Results");
    csvRows.push(`Limit (Significance Level α),${escapeCSV(formatDecimal(alpha, 4))}`);
    csvRows.push(`Degrees of Freedom,${escapeCSV(stats.degreesOfFreedom)}`);
    csvRows.push(`# of Pairwise Comparisons,${escapeCSV(stats.numComparisons)}`);
     let correctedAlpha = NaN;
     if (stats.numComparisons > 0) {
        correctedAlpha = alpha / stats.numComparisons;
        csvRows.push(`Bonferroni Corrected Alpha (α_bonf),${escapeCSV(formatScientific(correctedAlpha, 3))}`);
     } else {
        csvRows.push(`Bonferroni Corrected Alpha (α_bonf),N/A`);
     }
    csvRows.push("");

     const getInterpretation = (pValue: number | null | undefined, threshold: number) => {
        if (pValue === null || pValue === undefined || isNaN(pValue)) return "N/A";
        return pValue < threshold ? "Statistically different. Potential disparity; pursue further investigation." : "Not statistically different.";
     };

    csvRows.push("Test,Statistic,P-Value,Interpretation (vs α)");
    csvRows.push(
      `Chi-square,${escapeCSV(formatDecimal(stats.chiSquare.statistic))},${escapeCSV(formatScientific(stats.chiSquare.pValue))},"${escapeCSV(getInterpretation(stats.chiSquare.pValue, alpha))}"`
    );
     csvRows.push(
       `Chi-square (Yates),${escapeCSV(formatDecimal(stats.chiSquareYates.statistic))},${escapeCSV(formatScientific(stats.chiSquareYates.pValue))},"${escapeCSV(getInterpretation(stats.chiSquareYates.pValue, alpha))}"`
     );
    csvRows.push(
      `G-Test,${escapeCSV(formatDecimal(stats.gTest.statistic))},${escapeCSV(formatScientific(stats.gTest.pValue))},"${escapeCSV(getInterpretation(stats.gTest.pValue, alpha))}"`
    );
    csvRows.push("");
  }

  // --- Pairwise Comparisons Matrix Section ---
  if (reportData.pairwiseResultsMatrix && groupNames.length > 0 && reportData.overallStats && reportData.overallStats.numComparisons > 0) {
    csvRows.push("P-Values of Pairwise Chi-Square Comparisons with Bonferroni Correction");
     const correctedAlpha = reportData.overallStats.limitAlpha / reportData.overallStats.numComparisons;
     csvRows.push(`Bonferroni Corrected Alpha (α_bonf),${escapeCSV(formatScientific(correctedAlpha, 3))}`);
     csvRows.push("");


    const matrixHeader = ["Category", ...groupNames.sort().map(name => escapeCSV(name))];
    csvRows.push(matrixHeader.join(','));

    groupNames.sort().forEach(rowName => {
      const rowValues = [escapeCSV(rowName)];
      groupNames.sort().forEach(colName => {
        const pValue = reportData.pairwiseResultsMatrix?.[rowName]?.[colName];
        let formattedPValue = "N/A";
        if (rowName === colName) {
             formattedPValue = "-";
        } else if (pValue !== null && !isNaN(pValue as number)) {
             formattedPValue = formatScientific(pValue as number, 3);
        } else if (isNaN(pValue as number)) { // Handle explicit NaN for invalid pairs
            formattedPValue = "N/A (Invalid Pair)";
        }
        rowValues.push(escapeCSV(formattedPValue));
      });
      csvRows.push(rowValues.join(','));
    });
    csvRows.push("");
  }

    if (reportData.errors && reportData.errors.length > 0) {
        csvRows.push("Calculation Errors/Warnings");
        reportData.errors.forEach(err => csvRows.push(`"${escapeCSV(err)}"`));
        csvRows.push("");
    }


  const csvString = csvRows.join('\n');

  const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' });
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
