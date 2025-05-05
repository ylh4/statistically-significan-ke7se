
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { MultiComparisonResults } from "./calculations"; // Import necessary types
import { formatScientific, formatDecimal, formatPercent } from "./calculations"; // Import formatters
import type { FormValues as LocalFormValues } from "@/components/disparity-calculator"; // Import local type if needed for comparison or ensure consistency

// Define the type expected by exportToCSV if it differs from the local FormValues
// If they are the same, you can potentially remove this and use the imported LocalFormValues directly.
export interface ExportFormValues {
  alpha: number;
  groups: {
    name: string;
    experienced: number;
    notExperienced: number;
  }[];
  referenceCategories: string[];
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
    // Escape double quotes by doubling them and wrap the field in double quotes if it contains commas, double quotes, or newlines
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}

// Updated function to convert MultiComparisonResults to CSV string and trigger download
export function exportToCSV(
    reportData: MultiComparisonResults | null, // Expects the full report object
    inputData: ExportFormValues, // Use the renamed or specific type for export data
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
  // Include selected reference categories
  csvRows.push(`Selected Reference Category(ies),${escapeCSV(inputData.referenceCategories.join('; '))}`);
  csvRows.push(""); // Blank row

  // --- Categories Input Section ---
  csvRows.push("Input Categories (Groups)");
  csvRows.push("Category Name,# Experienced,# Not Experienced");
  inputData.groups.forEach(group => {
    csvRows.push(`${escapeCSV(group.name)},${escapeCSV(group.experienced)},${escapeCSV(group.notExperienced)}`);
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
      "Chi-Sq Contribution", // Added header
    ];
    csvRows.push(summaryHeaders.join(','));

    reportData.contingencySummary.forEach(row => {
      const values = [
        escapeCSV(row.name),
        escapeCSV(row.notExperienced),
        escapeCSV(row.experienced),
        escapeCSV(row.rowTotal),
        escapeCSV(formatPercent(row.percentExperienced)), // Use formatter
        escapeCSV(formatDecimal(row.expectedNotExperienced, 1)), // Use formatter
        escapeCSV(formatDecimal(row.expectedExperienced, 1)), // Use formatter
        escapeCSV(formatDecimal(row.chiSquareContribution, 3)), // Add formatted contribution
      ];
      csvRows.push(values.join(','));
    });

     // Add Totals Row
     const totals = reportData.totals;
     const totalRow = [
        escapeCSV("Column Subtotal"),
        escapeCSV(totals.totalNotExperienced),
        escapeCSV(totals.totalExperienced),
        escapeCSV(totals.grandTotal),
        escapeCSV(totals.grandTotal > 0 ? formatPercent((totals.totalExperienced / totals.grandTotal) * 100) : 'N/A'),
        escapeCSV(formatDecimal(totals.totalExpectedNotExperienced, 1)),
        escapeCSV(formatDecimal(totals.totalExpectedExperienced, 1)),
        escapeCSV(formatDecimal(totals.totalChiSquareContributions, 3)), // Add total contribution
     ];
     csvRows.push(totalRow.join(','));

    csvRows.push(""); // Blank row
  }

  // --- Overall Test Statistics Section ---
  if (reportData.overallStats) {
    const stats = reportData.overallStats;
    const alpha = stats.limitAlpha; // Get alpha for interpretation
    csvRows.push("Overall Test Results");
    csvRows.push(`Limit (Significance Level α),${escapeCSV(formatDecimal(alpha, 4))}`);
    csvRows.push(`Degrees of Freedom,${escapeCSV(stats.degreesOfFreedom)}`);
    csvRows.push(`# of Pairwise Comparisons,${escapeCSV(stats.numComparisons)}`);
     // Add Bonferroni Corrected Alpha
     let correctedAlpha = NaN;
     if (stats.numComparisons > 0) {
        correctedAlpha = alpha / stats.numComparisons;
        csvRows.push(`Bonferroni Corrected Alpha (α_bonf),${escapeCSV(formatScientific(correctedAlpha, 3))}`);
     } else {
        csvRows.push(`Bonferroni Corrected Alpha (α_bonf),N/A`);
     }
    csvRows.push(""); // separator

     // Helper for interpretation string
     const getInterpretation = (pValue: number | null | undefined, threshold: number) => {
        if (pValue === null || pValue === undefined || isNaN(pValue)) return "N/A";
        return pValue < threshold ? "Statistically different. Potential disparity; pursue further investigation." : "Not statistically different.";
     };

    // Chi-square
    csvRows.push("Test,Statistic,P-Value,Interpretation (vs α)"); // Clarified interpretation
    csvRows.push(
      `Chi-square,${escapeCSV(formatDecimal(stats.chiSquare.statistic))},${escapeCSV(formatScientific(stats.chiSquare.pValue))},"${escapeCSV(getInterpretation(stats.chiSquare.pValue, alpha))}"`
    );
    // Chi-square (Yates)
     csvRows.push(
       `Chi-square (Yates),${escapeCSV(formatDecimal(stats.chiSquareYates.statistic))},${escapeCSV(formatScientific(stats.chiSquareYates.pValue))},"${escapeCSV(getInterpretation(stats.chiSquareYates.pValue, alpha))}"`
     );
    // G-Test
    csvRows.push(
      `G-Test,${escapeCSV(formatDecimal(stats.gTest.statistic))},${escapeCSV(formatScientific(stats.gTest.pValue))},"${escapeCSV(getInterpretation(stats.gTest.pValue, alpha))}"`
    );
    csvRows.push(""); // Blank row
  }

  // --- Pairwise Comparisons Matrix Section ---
  if (reportData.pairwiseResultsMatrix && groupNames.length > 0 && reportData.overallStats && reportData.overallStats.numComparisons > 0) {
    csvRows.push("P-Values of Pairwise Chi-Square Comparisons with Bonferroni Correction");
     const correctedAlpha = reportData.overallStats.limitAlpha / reportData.overallStats.numComparisons;
     csvRows.push(`Bonferroni Corrected Alpha (α_bonf),${escapeCSV(formatScientific(correctedAlpha, 3))}`);
     csvRows.push(""); // Blank row


    // Matrix Header Row
    const matrixHeader = ["Category", ...groupNames.sort().map(name => escapeCSV(name))]; // Sort names for consistent order
    csvRows.push(matrixHeader.join(','));

    // Matrix Data Rows
    groupNames.sort().forEach(rowName => { // Sort names for consistent order
      const rowValues = [escapeCSV(rowName)];
      groupNames.sort().forEach(colName => { // Sort names for consistent order
        const pValue = reportData.pairwiseResultsMatrix?.[rowName]?.[colName];
        // Format p-value or indicate self/error
        let formattedPValue = "N/A"; // Default for errors or invalid
        if (rowName === colName) {
             formattedPValue = "-"; // Use dash for diagonal
        } else if (pValue !== null && !isNaN(pValue as number)) {
             formattedPValue = formatScientific(pValue as number, 3); // Use 3 sig digits
        }
        rowValues.push(escapeCSV(formattedPValue));
      });
      csvRows.push(rowValues.join(','));
    });
    csvRows.push(""); // Blank row

     // --- Pairwise Interpretation (based on selected references) ---
     if (inputData.referenceCategories.length > 0) {
        csvRows.push("Pairwise Interpretation (vs Selected References)");
         csvRows.push("Reference Category,Comparison Category,Corrected P-Value,Interpretation (vs α_bonf)");

          // Helper for pairwise interpretation string
          const getPairwiseInterpretation = (pValue: number | null | undefined, threshold: number) => {
             if (pValue === null || pValue === undefined || isNaN(pValue)) return "N/A";
             return pValue < threshold ? "Statistically different" : "Not statistically different";
          };


         inputData.referenceCategories
            .filter(refName => groupNames.includes(refName)) // Ensure ref exists
            .sort()
            .forEach(refName => {
                groupNames
                    .filter(compName => compName !== refName)
                    .sort()
                    .forEach(compName => {
                        const pValue = reportData.pairwiseResultsMatrix?.[refName]?.[compName];
                        const interpretation = getPairwiseInterpretation(pValue, correctedAlpha);
                        csvRows.push(
                           `${escapeCSV(refName)},${escapeCSV(compName)},${escapeCSV(formatScientific(pValue, 3))},"${escapeCSV(interpretation)}"`
                        );
                    });
         });
         csvRows.push(""); // Blank row
     }


  }

   // --- Errors Section ---
    if (reportData.errors && reportData.errors.length > 0) {
        csvRows.push("Calculation Errors/Warnings");
        reportData.errors.forEach(err => csvRows.push(`"${escapeCSV(err)}"`)); // Wrap errors in quotes
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
