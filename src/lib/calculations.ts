
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

// Structure for Contingency Table Summary data (Observed)
export interface ContingencySummaryData extends GroupInput {
    rowTotal: number;
    percentExperienced: number;
    // Added Expected values
    expectedExperienced: number;
    expectedNotExperienced: number;
    // Add contribution for overall Chi-square
    chiSquareContribution: number | null;
}


// Structure for overall test results
export interface OverallTestStats {
    limitAlpha: number;
    degreesOfFreedom: number;
    numComparisons: number; // Number of pairwise comparisons
    chiSquare: {
        statistic: number;
        pValue: number;
        // Interpretation removed, will be handled in UI based on pValue and alpha
    };
    chiSquareYates: { // Added Yates correction results
        statistic: number;
        pValue: number;
        // Interpretation removed
    };
    gTest: {
        statistic: number;
        pValue: number;
        // Interpretation removed
    };
}

// Structure for pairwise results (matrix) - Storing corrected p-values
// The keys of the outer object are the row category names.
// The keys of the inner object are the column category names.
// The value is the Bonferroni-corrected p-value.
export type PairwiseResultsMatrix = Record<string, Record<string, number | null>>; // Use null for diagonal or invalid pairs

// Structure for individual contributions (for display and verification)
export interface ContributionDetail {
    category: string;
    observedExperienced: number; // O_i
    expectedExperienced: number; // E_i
    chiSquareContrib: number; // (O_i - E_i)^2 / E_i
    yatesContrib: number;     // (|O_i - E_i| - 0.5)^2 / E_i
    gTestContrib: number;     // 2 * O_i * ln(O_i / E_i)
}


// Overall results structure returned by the main function
export interface MultiComparisonResults {
    contingencySummary: ContingencySummaryData[];
    overallStats: OverallTestStats | null; // Can be null if calculation fails early
    pairwiseResultsMatrix: PairwiseResultsMatrix | null; // Matrix of corrected p-values
    errors: string[]; // General calculation errors
    // Add overall totals for rendering
    totals: {
      grandTotal: number;
      totalExperienced: number;
      totalNotExperienced: number;
      totalExpectedExperienced: number;
      totalExpectedNotExperienced: number;
      totalChiSquareContributions: number; // Sum of contributions for verification
    } | null;
    contributions: ContributionDetail[] | null; // Detailed contributions per category
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
        // Treat extremely large finite values as potentially leading to p=0
         if (statistic > 1e15) return 0; // Heuristic threshold
         return 0; // P-value is 0 for an infinite statistic
    }
    if (statistic === 0 && df > 0) {
        return 1.0; // If statistic is 0, p-value is 1
    }
    // Use jStat's chisquare cumulative distribution function
    // Need the upper tail probability: P(X^2 > statistic) = 1 - P(X^2 <= statistic)
    try {
        // Clamp statistic slightly below Infinity if it's extremely large but finite
        const safeStatistic = Math.min(statistic, Number.MAX_VALUE);
        const cdf = jStat.chisquare.cdf(safeStatistic, df);
         // Handle potential precision issues where CDF might slightly exceed 1
         return Math.max(0, 1 - cdf);
    } catch (e) {
        console.error("Error calculating chi-square p-value:", e);
        return NaN;
    }
}

/**
 * Calculates the contribution of a single category to the overall Chi-square statistic.
 * Uses only the 'experienced' counts.
 * contrib_i = (O_i - E_i)^2 / E_i
 * Handles E_i = 0 case.
 */
function calculateChiSquareContribution(observed: number, expected: number, useYates: boolean = false): number {
    if (expected === 0) {
        return observed > 0 ? Infinity : 0; // Infinite contribution if O > 0 and E = 0
    }
    const diff = observed - expected;
    const yatesTerm = useYates ? 0.5 : 0;
    const absDiff = Math.abs(diff);
    const correctedDiff = Math.max(0, absDiff - yatesTerm); // Prevents negative base for power

    return (correctedDiff ** 2) / expected;
}

/**
 * Calculates the contribution of a single category to the overall G-Test statistic.
 * Uses only the 'experienced' counts.
 * G_contrib_i = 2 * O_i * ln(O_i / E_i)
 * Handles O_i = 0 or E_i = 0 cases.
 */
function calculateGTestContribution(observed: number, expected: number): number {
    if (observed === 0) {
        return 0; // 0 * ln(0/E) = 0
    }
    if (expected === 0) {
        return Infinity; // O > 0 and E = 0 -> infinite contribution
    }
    return 2 * observed * Math.log(observed / expected);
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

    // Check for zero margins which make the test invalid or result in ChiSq=0 or Infinity
     if (row1Sum === 0 || row2Sum === 0 || col1Sum === 0 || col2Sum === 0) {
         // Calculate expected values to see if the pattern is non-random
         const expected_a = (row1Sum * col1Sum) / n;
         // If expected is zero and observed is non-zero, it indicates infinite statistic,
         // but generally, zero margins imply either no data or perfect separation.
         // A chi-square of 0 is appropriate if observed matches expected perfectly (e.g., all zeros).
         // Let's recalculate using the sum of (O-E)^2/E, which handles zeros better.

         let chiSq = 0;
         const expectedValues = [
             [(row1Sum * col1Sum) / n, (row1Sum * col2Sum) / n],
             [(row2Sum * col1Sum) / n, (row2Sum * col2Sum) / n]
         ];
         const observedValues = [[a, b], [c, d]];

          for (let i = 0; i < 2; i++) {
              for (let j = 0; j < 2; j++) {
                   const O = observedValues[i][j];
                   const E = expectedValues[i][j];
                   if (E > 0) {
                       chiSq += Math.pow(O - E, 2) / E;
                   } else if (O > 0) {
                       return Infinity; // Observed > 0 when Expected = 0
                   }
               }
          }
         return chiSq; // Will be 0 if all observed counts are 0 or match expected 0s
     }


    // Standard shortcut formula for 2x2 Chi-square (without Yates')
    const numerator = n * Math.pow(a * d - b * c, 2);
    const denominator = row1Sum * row2Sum * col1Sum * col2Sum;

    // Denominator already checked for non-zero row/column sums
    // if (denominator === 0) {
    //      return numerator === 0 ? 0 : Infinity;
    // }

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
    if (alpha <= 0 || alpha > 1) { // Allow alpha = 1, but not > 1
        errors.push("Significance level (alpha) must be greater than 0 and less than or equal to 1.");
    }
    groups.forEach((group, index) => {
        if (!group.name || group.name.trim() === "") {
            errors.push(`Group ${index + 1} has an empty name.`);
        }
        if (group.experienced < 0 || group.notExperienced < 0 || !Number.isInteger(group.experienced) || !Number.isInteger(group.notExperienced)) {
            errors.push(`Counts for group "${group.name}" must be non-negative integers.`);
        }
    });

    // --- Early Exit if Validation Errors ---
    const initialTotals = {
        grandTotal: 0, totalExperienced: 0, totalNotExperienced: 0,
        totalExpectedExperienced: 0, totalExpectedNotExperienced: 0, totalChiSquareContributions: 0
    };
    const initialSummary: ContingencySummaryData[] = groups.map(g => ({
        ...g, rowTotal: g.experienced + g.notExperienced, percentExperienced: 0,
        expectedExperienced: 0, expectedNotExperienced: 0, chiSquareContribution: null
    }));

    if (errors.length > 0) {
        return {
            contingencySummary: initialSummary, // Return empty structure
            overallStats: null,
            pairwiseResultsMatrix: null,
            totals: initialTotals,
            errors,
            contributions: null,
        };
    }

    // --- Phase 1: Prepare Contingency Table Summary Data (Observed & Expected) ---
    const grandTotal = groups.reduce((sum, g) => sum + g.experienced + g.notExperienced, 0);
    const totalExperienced = groups.reduce((sum, g) => sum + g.experienced, 0);
    const totalNotExperienced = grandTotal - totalExperienced; // More robust way

    if (grandTotal === 0) {
         errors.push("Total number of observations is zero.");
         return { contingencySummary: initialSummary, overallStats: null, pairwiseResultsMatrix: null, totals: initialTotals, errors, contributions: null };
    }

    // Calculate contributions and summary data
    let totalChiSquareContributions = 0;
    const contributionsDetails: ContributionDetail[] = [];

    const contingencySummary: ContingencySummaryData[] = groups.map(g => {
        const rowTotal = g.experienced + g.notExperienced;
        let expectedExperienced = 0;
        let expectedNotExperienced = 0;
        let chiSquareContribution: number | null = null;
        let yatesContribution: number = NaN;
        let gTestContribution: number = NaN;


        if (grandTotal > 0 && rowTotal > 0) {
            expectedExperienced = (rowTotal * totalExperienced) / grandTotal;
            expectedNotExperienced = (rowTotal * totalNotExperienced) / grandTotal;

            // Calculate contributions based ONLY on the experienced column (O_i vs E_i)
            chiSquareContribution = calculateChiSquareContribution(g.experienced, expectedExperienced, false);
            yatesContribution = calculateChiSquareContribution(g.experienced, expectedExperienced, true);
            gTestContribution = calculateGTestContribution(g.experienced, expectedExperienced);

             // Add to total contribution sum if valid
            if (isFinite(chiSquareContribution)) {
                 totalChiSquareContributions += chiSquareContribution;
            }

            // Store detailed contributions
            contributionsDetails.push({
                category: g.name,
                observedExperienced: g.experienced,
                expectedExperienced: expectedExperienced,
                chiSquareContrib: chiSquareContribution, // Store potentially infinite value
                yatesContrib: yatesContribution,       // Store potentially infinite value
                gTestContrib: gTestContribution        // Store potentially infinite value
            });

            // Check for expected counts < 5 (common warning for Chi-square validity)
            // Check both experienced and not experienced for general table validity
             if (expectedExperienced < 5 || expectedNotExperienced < 5) {
                const warningMsg = `Warning: Group "${g.name}" has an expected count less than 5. Test approximation may be less accurate.`;
                if (!errors.includes(warningMsg)) {
                    errors.push(warningMsg);
                }
             }
        } else {
             // Handle rowTotal = 0 case for contributions
             contributionsDetails.push({
                 category: g.name,
                 observedExperienced: g.experienced,
                 expectedExperienced: 0,
                 chiSquareContrib: 0, // No contribution if no data
                 yatesContrib: 0,
                 gTestContrib: 0
             });
        }


        return {
            ...g,
            rowTotal: rowTotal,
            percentExperienced: rowTotal > 0 ? (g.experienced / rowTotal) * 100 : 0,
            expectedExperienced: expectedExperienced,
            expectedNotExperienced: expectedNotExperienced,
            chiSquareContribution: chiSquareContribution // Store contribution in summary
        };
    });

    const totalExpectedExperienced = contingencySummary.reduce((sum, g) => sum + g.expectedExperienced, 0);
    const totalExpectedNotExperienced = contingencySummary.reduce((sum, g) => sum + g.expectedNotExperienced, 0);

    const finalTotals = {
        grandTotal, totalExperienced, totalNotExperienced,
        totalExpectedExperienced, totalExpectedNotExperienced,
        totalChiSquareContributions // Add sum of chi-square contributions
    };


     // Warning if any group has zero total (affects overall tests) - redundant check but safe
    if (contingencySummary.some(g => g.rowTotal === 0)) {
         const zeroWarn = "Warning: One or more groups have zero total observations. Overall tests might be affected or invalid.";
         if (!errors.includes(zeroWarn)) errors.push(zeroWarn);
    }


    // --- Phase 2: Calculate Overall Test Statistics ---
    let overallStats: OverallTestStats | null = null;
    try {
        // Correct degrees of freedom: df = k - 1 for k categories
        const degreesOfFreedom = Math.max(1, numGroups - 1);
        const numComparisons = numGroups >= 2 ? numGroups * (numGroups - 1) / 2 : 0;

        // Overall Chi-square (Pearson) - Sum of contributions from experienced column
        const overallChiSquareStat = contributionsDetails.reduce((sum, c) => sum + (isFinite(c.chiSquareContrib) ? c.chiSquareContrib : 0), 0);
        // Handle potential Infinity if any contribution was Infinity
        if (contributionsDetails.some(c => !isFinite(c.chiSquareContrib) && c.chiSquareContrib > 0)) {
             overallStats = {
                 limitAlpha: alpha, degreesOfFreedom, numComparisons,
                 chiSquare: { statistic: Infinity, pValue: 0 },
                 chiSquareYates: { statistic: Infinity, pValue: 0 }, // Assume Yates also infinite
                 gTest: { statistic: Infinity, pValue: 0 } // Assume G-test also infinite
             };
        } else {
             const chiSquareP = chiSquarePValue(overallChiSquareStat, degreesOfFreedom);

             // Overall Chi-square with Yates' correction - Sum of Yates contributions
             const overallChiSquareYatesStat = contributionsDetails.reduce((sum, c) => sum + (isFinite(c.yatesContrib) ? c.yatesContrib : 0), 0);
             const chiSquareYatesP = chiSquarePValue(overallChiSquareYatesStat, degreesOfFreedom);

             // Overall G-Test - Sum of G-Test contributions
             const overallGTestStat = contributionsDetails.reduce((sum, c) => sum + (isFinite(c.gTestContrib) ? c.gTestContrib : 0), 0);
             const gTestP = chiSquarePValue(overallGTestStat, degreesOfFreedom);

             overallStats = {
                 limitAlpha: alpha,
                 degreesOfFreedom,
                 numComparisons,
                 chiSquare: {
                     statistic: overallChiSquareStat,
                     pValue: chiSquareP,
                 },
                 chiSquareYates: {
                     statistic: overallChiSquareYatesStat,
                     pValue: chiSquareYatesP,
                 },
                 gTest: {
                     statistic: overallGTestStat,
                     pValue: gTestP,
                 },
             };
         }

    } catch (e: any) {
        console.error("Error calculating overall stats:", e);
        errors.push(`Error during overall test calculation: ${e.message}`);
        overallStats = null; // Ensure it's null if error occurs
    }


    // --- Phase 3: Calculate Pairwise Comparisons with Bonferroni Correction ---
    let pairwiseResultsMatrix: PairwiseResultsMatrix | null = null;
    // Proceed only if overall stats were calculated and there are comparisons to make
    if (numGroups >= 2 && overallStats && overallStats.numComparisons > 0) {
         pairwiseResultsMatrix = {};
         // Use max(1, numComparisons) to avoid division by zero if only 1 group somehow gets here
         const bonferroniDenominator = Math.max(1, overallStats.numComparisons);

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

                 // Skip if either group has zero total observation - makes 2x2 invalid
                 if (group1.rowTotal === 0 || group2.rowTotal === 0) {
                    pairwiseResultsMatrix[name1][name2] = NaN; // Indicator for invalid pair
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
                     const pairErrorMsg = `Error in pairwise calculation for ${name1} vs ${name2}: ${e.message}`;
                     if (!errors.includes(pairErrorMsg)) errors.push(pairErrorMsg);
                }
            }
        }
         // Fill diagonal with 1.0 (or null/NaN as preferred)
         groupNames.forEach(name => {
             if (pairwiseResultsMatrix && pairwiseResultsMatrix[name]) {
                 // Ensure the diagonal entry exists before setting it
                 if (!(name in pairwiseResultsMatrix[name])) {
                    pairwiseResultsMatrix[name][name] = 1.0;
                 } else if (pairwiseResultsMatrix[name][name] === null) { // Only set if not already set (e.g., by error)
                    pairwiseResultsMatrix[name][name] = 1.0;
                 }
             }
         });
    } else if (overallStats && overallStats.numComparisons === 0 && numGroups >= 1) {
        // Handle case with only one group (or somehow numComparisons is 0) - no comparisons possible
        const singleGroupMsg = "Only one group valid for comparison, no pairwise comparisons possible.";
        if (!errors.includes(singleGroupMsg)) errors.push(singleGroupMsg);
    } else if (!overallStats) {
         const skipPairwiseMsg = "Overall statistics could not be calculated, skipping pairwise comparisons.";
         if (!errors.includes(skipPairwiseMsg)) errors.push(skipPairwiseMsg);
    }


    return {
        contingencySummary,
        overallStats,
        pairwiseResultsMatrix,
        totals: finalTotals,
        errors,
        contributions: contributionsDetails, // Include detailed contributions
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
        // Ensure consistent format like 0.00E+0 for significantDigits=3
        return (0).toExponential(significantDigits - 1).toUpperCase().replace('E', 'E+');
    }
     if (!isFinite(value)) {
         return value > 0 ? "Infinity" : "-Infinity";
     }

    // Use toExponential for formatting
    let exponentialString = value.toExponential(significantDigits - 1).toUpperCase(); // E.g., "1.2345E-4" -> "1.23E-4" for 3 digits

     // Ensure the exponent part always has a sign (+ or -)
     const parts = exponentialString.split('E');
     if (parts.length === 2) {
         const exponent = parseInt(parts[1], 10);
         // Check if the exponent string already has a sign
         if (!parts[1].startsWith('+') && !parts[1].startsWith('-')) {
            const sign = exponent >= 0 ? '+' : ''; // Add '+' only if non-negative AND sign missing
            exponentialString = `${parts[0]}E${sign}${exponent}`;
         } else {
            // Ensure '+' sign is present for non-negative exponents if split correctly gave sign
            if (exponent >= 0 && !parts[1].startsWith('+')) {
                 exponentialString = `${parts[0]}E+${exponent}`;
            }
         }
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
