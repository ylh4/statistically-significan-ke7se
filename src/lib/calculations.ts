
import {
    jStat
} from 'jstat'; // Using jStat for Chi-square p-value calculation


// Input structure for each group/category
export interface GroupInput {
    name: string;
    experienced: number; // Count of those who experienced the outcome
    notExperienced: number; // Count of those who did NOT experience the outcome
}

// Input for the overall calculation
export interface MultiComparisonInputs {
    alpha: number;
    groups: GroupInput[];
}

// Structure for Contingency Table Summary data
export interface ContingencySummaryData extends GroupInput {
    rowTotal: number;
    percentExperienced: number;
}

// Structure for overall test results
export interface OverallTestStats {
    limitAlpha: number;
    degreesOfFreedom: number;
    numComparisons: number; // Number of pairwise comparisons
    chiSquare: {
        statistic: number;
        pValue: number;
        interpretation: string;
    };
    chiSquareYates: { // Added Yates correction results
        statistic: number;
        pValue: number;
        interpretation: string;
    };
    gTest: {
        statistic: number;
        pValue: number;
        interpretation: string;
    };
}

// Structure for pairwise results (matrix) - Storing corrected p-values
// The keys of the outer object are the row category names.
// The keys of the inner object are the column category names.
// The value is the Bonferroni-corrected p-value.
export type PairwiseResultsMatrix = Record<string, Record<string, number | null>>; // Use null for diagonal or invalid pairs


// Overall results structure returned by the main function
export interface MultiComparisonResults {
    contingencySummary: ContingencySummaryData[];
    overallStats: OverallTestStats | null; // Can be null if calculation fails early
    pairwiseResultsMatrix: PairwiseResultsMatrix | null; // Matrix of corrected p-values
    errors: string[]; // General calculation errors
}


// --- Helper Functions ---

/**
 * Calculates the p-value for a given Chi-square statistic and degrees of freedom.
 * Uses the upper tail probability (1 - CDF).
 */
function chiSquarePValue(statistic: number, df: number): number {
    if (statistic < 0 || df <= 0 || isNaN(statistic) || isNaN(df)) {
        return NaN; // Invalid input
    }
     if (!isFinite(statistic)) {
        return 0; // P-value is 0 for an infinite statistic
    }
    // Use jStat's chisquare cumulative distribution function
    // Need the upper tail probability: P(X^2 > statistic) = 1 - P(X^2 <= statistic)
    try {
        // Clamp statistic slightly below Infinity if it's extremely large but finite
        const safeStatistic = Math.min(statistic, Number.MAX_VALUE);
        return 1 - jStat.chisquare.cdf(safeStatistic, df);
    } catch (e) {
        console.error("Error calculating chi-square p-value:", e);
        return NaN;
    }
}

/**
 * Calculates Chi-square statistic for a k x 2 contingency table.
 * table = [[exp1, notExp1], [exp2, notExp2], ..., [expK, notExpK]]
 * Optionally applies Yates' correction element-wise (use cautiously for k>2).
 */
function calculateKx2ChiSquare(
    groupsData: Array<{ experienced: number; notExperienced: number; rowTotal: number }>,
    totalExperienced: number,
    totalNotExperienced: number,
    grandTotal: number,
    useYates: boolean = false
): number {
    let chiSquareStat = 0;

    if (grandTotal === 0) return 0;

    groupsData.forEach(group => {
        if (group.rowTotal > 0) {
            const expectedExperienced = (group.rowTotal * totalExperienced) / grandTotal;
            const expectedNotExperienced = (group.rowTotal * totalNotExperienced) / grandTotal;

            // Experienced term
            if (expectedExperienced > 0) {
                const diff = group.experienced - expectedExperienced;
                const yatesTerm = useYates ? 0.5 : 0;
                const absDiff = Math.abs(diff);
                 // Prevent negative base for power when diff is small and yates is used
                 const correctedDiff = Math.max(0, absDiff - yatesTerm);
                 chiSquareStat += (correctedDiff ** 2) / expectedExperienced;

            } else if (group.experienced !== 0) {
                return Infinity; // Observed count where expected is 0
            } // else observed is 0, expected is 0, contribution is 0

            // Not Experienced term
            if (expectedNotExperienced > 0) {
                 const diff = group.notExperienced - expectedNotExperienced;
                 const yatesTerm = useYates ? 0.5 : 0;
                 const absDiff = Math.abs(diff);
                  // Prevent negative base for power
                 const correctedDiff = Math.max(0, absDiff - yatesTerm);
                 chiSquareStat += (correctedDiff ** 2) / expectedNotExperienced;
            } else if (group.notExperienced !== 0) {
                return Infinity; // Observed count where expected is 0
            } // else observed is 0, expected is 0, contribution is 0
        }
    });

    return chiSquareStat;
}


/**
 * Calculates the G-Test statistic for a k x 2 contingency table.
 * G = 2 * sum(O * ln(O/E))
 */
function calculateKx2GTest(
    groupsData: Array<{ experienced: number; notExperienced: number; rowTotal: number }>,
    totalExperienced: number,
    totalNotExperienced: number,
    grandTotal: number
): number {
     let gTestStat = 0;

     if (grandTotal === 0) return 0;

     groupsData.forEach(group => {
         if (group.rowTotal > 0) {
             const expectedExperienced = (group.rowTotal * totalExperienced) / grandTotal;
             const expectedNotExperienced = (group.rowTotal * totalNotExperienced) / grandTotal;

              // G-Test contribution (handle observed = 0 cases)
             // Experienced term
             if (group.experienced > 0) {
                  if (expectedExperienced > 0) {
                     gTestStat += group.experienced * Math.log(group.experienced / expectedExperienced);
                  } else {
                      // Observed > 0 but Expected = 0 -> infinite statistic
                      return Infinity;
                  }
             } // If observed is 0, contribution is 0 * log(0/E) = 0

             // Not Experienced term
             if (group.notExperienced > 0) {
                 if (expectedNotExperienced > 0) {
                     gTestStat += group.notExperienced * Math.log(group.notExperienced / expectedNotExperienced);
                 } else {
                     // Observed > 0 but Expected = 0 -> infinite statistic
                     return Infinity;
                 }
             } // If observed is 0, contribution is 0
         }
     });

     // Check if gTestStat became NaN or Infinity before multiplying
     if (!isFinite(gTestStat)) {
        return gTestStat; // Return NaN or Infinity directly
     }

     return 2 * gTestStat; // Final step for G-Test
}

/**
 * Calculates Chi-square statistic for a 2x2 contingency table.
 * table = [[a, b], [c, d]]
 * Used for pairwise comparisons. NO Yates correction here by default.
 */
function calculate2x2ChiSquarePairwise(table: number[][]): number {
    const [
        [a, b],
        [c, d]
    ] = table;
    const n = a + b + c + d;
    if (n === 0) return 0;

    const row1Sum = a + b;
    const row2Sum = c + d;
    const col1Sum = a + c;
    const col2Sum = b + d;

    // Shortcut formula for 2x2 Chi-square (without Yates')
    // More prone to floating point issues with very large numbers, but standard.
    const numerator = n * Math.pow(a * d - b * c, 2);
    const denominator = row1Sum * row2Sum * col1Sum * col2Sum;

    if (denominator === 0) {
         // This happens if a row or column total is zero.
         // If numerator is also 0, result is NaN (or 0 by convention).
         // If numerator is non-zero, result is Infinity.
         return numerator === 0 ? 0 : Infinity;
    }

    return numerator / denominator;
}

// --- Main Calculation Function ---

export function performMultiComparisonReport(inputs: MultiComparisonInputs): MultiComparisonResults {
    const {
        alpha,
        groups
    } = inputs;
    const errors: string[] = [];
    const numGroups = groups.length;

    // --- Basic Input Validations ---
    if (numGroups < 2) {
        errors.push("At least two groups are required for comparison.");
    }
    if (alpha <= 0 || alpha >= 1) {
        errors.push("Significance level (alpha) must be between 0 and 1.");
    }
    groups.forEach((group, index) => {
        if (!group.name || group.name.trim() === "") {
            errors.push(`Group ${index + 1} has an empty name.`);
        }
        if (group.experienced < 0 || group.notExperienced < 0 || !Number.isInteger(group.experienced) || !Number.isInteger(group.notExperienced)) {
            errors.push(`Counts for group "${group.name}" must be non-negative integers.`);
        }
    });

    if (errors.length > 0) {
        return {
            contingencySummary: [],
            overallStats: null,
            pairwiseResultsMatrix: null,
            errors
        };
    }

    // --- Phase 1: Prepare Contingency Table Summary Data ---
    const contingencySummary: ContingencySummaryData[] = groups.map(g => {
        const rowTotal = g.experienced + g.notExperienced;
        return {
            ...g,
            rowTotal: rowTotal,
            percentExperienced: rowTotal > 0 ? (g.experienced / rowTotal) * 100 : 0,
        };
    });

    const grandTotal = contingencySummary.reduce((sum, g) => sum + g.rowTotal, 0);
    const totalExperienced = contingencySummary.reduce((sum, g) => sum + g.experienced, 0);
    const totalNotExperienced = contingencySummary.reduce((sum, g) => sum + g.notExperienced, 0);

    if (grandTotal === 0) {
         errors.push("Total number of observations is zero.");
         return { contingencySummary, overallStats: null, pairwiseResultsMatrix: null, errors };
    }

     // Warning if any group has zero total (affects overall tests)
    if (contingencySummary.some(g => g.rowTotal === 0)) {
        errors.push("Warning: One or more groups have zero total observations. Overall tests might be affected.");
    }


    // --- Phase 2: Calculate Overall Test Statistics ---
    let overallStats: OverallTestStats | null = null;
    try {
        const degreesOfFreedom = numGroups - 1; // For k x 2 table
        const numComparisons = numGroups * (numGroups - 1) / 2;

        // Calculate overall Chi-square (Pearson)
        const overallChiSquareStat = calculateKx2ChiSquare(contingencySummary, totalExperienced, totalNotExperienced, grandTotal, false);
        const chiSquareP = chiSquarePValue(overallChiSquareStat, degreesOfFreedom);

        // Calculate overall Chi-square with Yates' correction
        // Note: Applying Yates element-wise for k>2 is debated. We implement as requested.
        const overallChiSquareYatesStat = calculateKx2ChiSquare(contingencySummary, totalExperienced, totalNotExperienced, grandTotal, true);
        const chiSquareYatesP = chiSquarePValue(overallChiSquareYatesStat, degreesOfFreedom);


        // Calculate overall G-Test
        const overallGTestStat = calculateKx2GTest(contingencySummary, totalExperienced, totalNotExperienced, grandTotal);
        const gTestP = chiSquarePValue(overallGTestStat, degreesOfFreedom);

        // Define interpretation function
        const interpretation = (p: number) => {
             if (isNaN(p)) return "Invalid result";
             return p < alpha ?
                "Statistically different. Potential disparity; pursue further investigation." :
                "Not statistically different.";
        }

        overallStats = {
            limitAlpha: alpha,
            degreesOfFreedom,
            numComparisons,
            chiSquare: {
                statistic: overallChiSquareStat,
                pValue: chiSquareP,
                interpretation: interpretation(chiSquareP),
            },
             chiSquareYates: { // Include Yates results
                statistic: overallChiSquareYatesStat,
                pValue: chiSquareYatesP,
                interpretation: interpretation(chiSquareYatesP),
            },
            gTest: {
                statistic: overallGTestStat,
                pValue: gTestP,
                interpretation: interpretation(gTestP),
            },
        };

    } catch (e: any) {
        console.error("Error calculating overall stats:", e);
        errors.push(`Error during overall test calculation: ${e.message}`);
        overallStats = null; // Ensure it's null if error occurs
    }


    // --- Phase 3: Calculate Pairwise Comparisons with Bonferroni Correction ---
    let pairwiseResultsMatrix: PairwiseResultsMatrix | null = null;
    if (numGroups >= 2 && overallStats && overallStats.numComparisons > 0) {
         pairwiseResultsMatrix = {};
         const bonferroniDenominator = overallStats.numComparisons; // Denominator for correction

        // Initialize matrix
        const groupNames = contingencySummary.map(g => g.name);
        groupNames.forEach(rowName => {
            pairwiseResultsMatrix![rowName] = {};
            groupNames.forEach(colName => {
                pairwiseResultsMatrix![rowName][colName] = null; // Initialize with null
            });
        });


        for (let i = 0; i < numGroups; i++) {
            for (let j = i + 1; j < numGroups; j++) {
                const group1 = contingencySummary[i];
                const group2 = contingencySummary[j];
                const name1 = group1.name;
                const name2 = group2.name;

                 // Skip if either group has zero total observation
                 if (group1.rowTotal === 0 || group2.rowTotal === 0) {
                    pairwiseResultsMatrix[name1][name2] = NaN; // Or another indicator for invalid pair
                    pairwiseResultsMatrix[name2][name1] = NaN;
                    continue;
                 }


                try {
                     // Create 2x2 table for the pair
                     const table: number[][] = [
                        [group1.experienced, group1.notExperienced],
                        [group2.experienced, group2.notExperienced],
                     ];

                     // Calculate pairwise Chi-square (NO Yates' here)
                     const chiSqStatPair = calculate2x2ChiSquarePairwise(table);
                     const pValueRaw = chiSquarePValue(chiSqStatPair, 1); // df=1 for 2x2

                     // Apply Bonferroni correction
                     const correctedPValue = Math.min(1.0, pValueRaw * bonferroniDenominator);

                     // Store the corrected p-value in the matrix (symmetric)
                     pairwiseResultsMatrix[name1][name2] = correctedPValue;
                     pairwiseResultsMatrix[name2][name1] = correctedPValue;


                } catch (e: any) {
                    console.error(`Error calculating pairwise comparison for ${name1} vs ${name2}:`, e);
                    // Store NaN or another indicator for error in the matrix
                    pairwiseResultsMatrix[name1][name2] = NaN;
                    pairwiseResultsMatrix[name2][name1] = NaN;
                     errors.push(`Error in pairwise calculation for ${name1} vs ${name2}: ${e.message}`);
                }
            }
        }
         // Fill diagonal with 1.000E+00 (or null/NaN as preferred)
         groupNames.forEach(name => {
             if (pairwiseResultsMatrix && pairwiseResultsMatrix[name]) {
                 pairwiseResultsMatrix[name][name] = 1.0; // Represents self-comparison p-value
             }
         });
    } else if (overallStats && overallStats.numComparisons === 0 && numGroups === 1) {
        // Handle case with only one group - no comparisons possible
        errors.push("Only one group provided, no pairwise comparisons possible.");
    } else if (!overallStats) {
         errors.push("Overall statistics could not be calculated, skipping pairwise comparisons.");
    }


    return {
        contingencySummary,
        overallStats,
        pairwiseResultsMatrix,
        errors
    };
}

/**
 * Formats a number into scientific notation with a specified number of significant digits.
 * e.g., formatScientific(0.00012345, 3) => "1.23E-4"
 * e.g., formatScientific(12345, 3) => "1.23E+4"
 * Handles NaN, Infinity, and zero appropriately.
 */
export function formatScientific(value: number | null | undefined, significantDigits: number = 3): string {
    if (value === null || value === undefined || isNaN(value)) {
        return "N/A";
    }
    if (value === 0) {
        return `0.00${'0'.repeat(Math.max(0, significantDigits - 1))}E+0`; // Or just "0.00E+0" ? -> Let's use toExponential
         // return (0).toExponential(significantDigits - 1).toUpperCase(); // e.g., 0.00E+0 for 3 digits
    }
     if (!isFinite(value)) {
         return value > 0 ? "Infinity" : "-Infinity";
     }

    // Use toExponential for formatting
    const exponentialString = value.toExponential(significantDigits - 1).toUpperCase(); // E.g., "1.2345E-4" -> "1.23E-4" for 3 digits

     // Ensure the exponent part has a sign (+ or -)
     const parts = exponentialString.split('E');
     if (parts.length === 2) {
         const exponent = parseInt(parts[1], 10);
         const sign = exponent >= 0 ? '+' : ''; // Add '+' for non-negative exponents
         return `${parts[0]}E${sign}${exponent}`;
     }

    return exponentialString; // Fallback if split fails (shouldn't happen for valid numbers)
}

/**
 * Formats a number to a fixed number of decimal places.
 * Handles NaN, Infinity.
 */
export function formatDecimal(value: number | null | undefined, decimalPlaces: number = 3): string {
     if (value === null || value === undefined || isNaN(value)) {
         return "N/A";
     }
      if (!isFinite(value)) {
          return value > 0 ? "Infinity" : "-Infinity";
      }
     return value.toFixed(decimalPlaces);
}

/**
 * Formats a percentage value.
 */
export function formatPercent(value: number | null | undefined, decimalPlaces: number = 1): string {
     if (value === null || value === undefined || isNaN(value)) {
         return "N/A";
     }
      if (!isFinite(value)) {
          return value > 0 ? "Infinity%" : "-Infinity%";
      }
     return `${value.toFixed(decimalPlaces)}%`;
}
