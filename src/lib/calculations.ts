
import {
    jStat
} from 'jstat'; // Using jStat for Chi-square p-value calculation


// Input structure for each group
export interface GroupData {
    name: string;
    experienced: number; // Count of those who experienced the outcome
    notExperienced: number; // Count of those who did NOT experience the outcome
}

// Input for the overall calculation
export interface MultiComparisonInputs {
    alpha: number;
    groups: GroupData[];
}

// Structure for overall test results
export interface OverallTestStats {
    degreesOfFreedom: number;
    numComparisons: number; // Number of pairwise comparisons
    chiSquare: {
        statistic: number;
        pValue: number;
        interpretation: string;
    };
    // Yates correction is typically for 2x2 tables, not usually applied globally like this.
    // Including as per image, but its interpretation might be nuanced. Assuming pairwise Yates for now.
    // chiSquareYates?: { statistic: number; pValue: number; interpretation: string };
    gTest: {
        statistic: number;
        pValue: number;
        interpretation: string;
    };
}

// Structure for pairwise results (matrix)
export interface PairwiseResult {
    group1: string;
    group2: string;
    pValue: number; // Raw p-value
    correctedPValue: number; // Bonferroni corrected p-value
    isSignificant: boolean; // Based on corrected p-value < alpha
    error?: string; // Optional error message for this specific pair
}

// Overall results structure returned by the main function
export interface MultiComparisonResults {
    observedData: (GroupData & {
        rowTotal: number;
        percentExperienced: number;
    })[];
    overallStats: OverallTestStats | null; // Can be null if calculation fails early
    pairwiseResults: PairwiseResult[];
    errors: string[]; // General calculation errors
}


// --- Helper Functions ---

/**
 * Calculates the p-value for a given Chi-square statistic and degrees of freedom.
 * Uses the upper tail probability (1 - CDF).
 */
function chiSquarePValue(statistic: number, df: number): number {
    if (statistic < 0 || df <= 0) {
        return NaN; // Invalid input
    }
    // Use jStat's chisquare cumulative distribution function
    // Need the upper tail probability: P(X^2 > statistic) = 1 - P(X^2 <= statistic)
    try {
        return 1 - jStat.chisquare.cdf(statistic, df);
    } catch (e) {
        console.error("Error calculating chi-square p-value:", e);
        return NaN;
    }
}

/**
 * Calculates Chi-square statistic for a 2x2 contingency table.
 * table = [[a, b], [c, d]]
 * Optionally applies Yates' correction.
 */
function calculate2x2ChiSquare(table: number[][], useYates: boolean = false): {
    statistic: number;df: number
} {
    const [
        [a, b],
        [c, d]
    ] = table;
    const n = a + b + c + d;
    if (n === 0) return {
        statistic: 0,
        df: 1
    };

    const row1Sum = a + b;
    const row2Sum = c + d;
    const col1Sum = a + c;
    const col2Sum = b + d;

    // Calculate expected values
    const expA = (row1Sum * col1Sum) / n;
    const expB = (row1Sum * col2Sum) / n;
    const expC = (row2Sum * col1Sum) / n;
    const expD = (row2Sum * col2Sum) / n;

    // Check for zero expected values - leads to division by zero
    if ([expA, expB, expC, expD].some(exp => exp === 0)) {
        // If observed is also zero, contribution is 0. If observed is non-zero, statistic is technically Infinity.
        // Handle practical case: if any expected is 0, chi-square is problematic.
         if ((expA === 0 && a !== 0) || (expB === 0 && b !== 0) || (expC === 0 && c !== 0) || (expD === 0 && d !== 0)) {
           // Return Infinity or a very large number to indicate extreme difference
           return { statistic: Infinity, df: 1 };
         }
          // If expected and observed are 0, contribution is 0. If all observed are 0, stat is 0.
         // If only some expected are 0 but corresponding observed are also 0, proceed cautiously.
    }


    let chiSquareStat = 0;

     // Standard formula - more stable than the shortcut formula, especially with Yates'
     const terms = [
         { obs: a, exp: expA },
         { obs: b, exp: expB },
         { obs: c, exp: expC },
         { obs: d, exp: expD },
     ];

     for (const { obs, exp } of terms) {
         if (exp === 0) {
              if (obs !== 0) return { statistic: Infinity, df: 1 }; // Observed value where none expected
              // else, obs is 0, contribution is 0, continue
         } else {
             const diff = obs - exp;
             const yatesCorrection = useYates ? 0.5 : 0;
             const term = (Math.abs(diff) - yatesCorrection) ** 2 / exp;
              // Ensure the corrected difference doesn't go below zero
             if (useYates && Math.abs(diff) <= yatesCorrection) {
                 chiSquareStat += 0; // Term becomes 0 if correction exceeds difference
             } else {
                chiSquareStat += term;
             }
         }
     }


    return {
        statistic: chiSquareStat,
        df: 1
    }; // df for 2x2 table is 1
}


// --- Main Calculation Function ---

export function performMultipleComparisons(inputs: MultiComparisonInputs): MultiComparisonResults {
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
            observedData: [],
            overallStats: null,
            pairwiseResults: [],
            errors
        };
    }

    // --- Prepare Data & Calculate Totals ---
    const observedData = groups.map(g => ({
        ...g,
        rowTotal: g.experienced + g.notExperienced,
        percentExperienced: (g.experienced + g.notExperienced) > 0 ? (g.experienced / (g.experienced + g.notExperienced)) * 100 : 0,
    }));

    const grandTotal = observedData.reduce((sum, g) => sum + g.rowTotal, 0);
    const totalExperienced = observedData.reduce((sum, g) => sum + g.experienced, 0);
    const totalNotExperienced = observedData.reduce((sum, g) => sum + g.notExperienced, 0);

    if (grandTotal === 0) {
         errors.push("Total number of observations is zero.");
         return { observedData, overallStats: null, pairwiseResults: [], errors };
    }

     // Ensure all row totals are > 0 for overall tests
    if (observedData.some(g => g.rowTotal === 0)) {
        errors.push("One or more groups have zero total observations, which may affect overall test validity.");
        // Decide if you want to proceed or stop. Proceeding might be okay for pairwise if *some* groups are valid.
    }

    // --- Calculate Overall Test Statistics ---
    let overallStats: OverallTestStats | null = null;
    try {
        const degreesOfFreedom = numGroups - 1; // Assuming comparison across groups for one outcome variable
        const numComparisons = numGroups * (numGroups - 1) / 2;

        // Overall Chi-square
        let overallChiSquareStat = 0;
        let overallGTestStat = 0;

        observedData.forEach(group => {
            if (group.rowTotal > 0) { // Avoid division by zero
                const expectedExperienced = (group.rowTotal * totalExperienced) / grandTotal;
                const expectedNotExperienced = (group.rowTotal * totalNotExperienced) / grandTotal;

                 // Chi-square contribution
                 if (expectedExperienced > 0) {
                     overallChiSquareStat += (group.experienced - expectedExperienced) ** 2 / expectedExperienced;
                 } else if (group.experienced !== 0) {
                     overallChiSquareStat = Infinity; // Observed count where expected is 0
                 }
                 if (expectedNotExperienced > 0) {
                     overallChiSquareStat += (group.notExperienced - expectedNotExperienced) ** 2 / expectedNotExperienced;
                 } else if (group.notExperienced !== 0) {
                     overallChiSquareStat = Infinity; // Observed count where expected is 0
                 }


                // G-Test contribution (handle observed = 0 cases)
                if (group.experienced > 0 && expectedExperienced > 0) {
                    overallGTestStat += group.experienced * Math.log(group.experienced / expectedExperienced);
                } else if (expectedExperienced === 0 && group.experienced !== 0) {
                     overallGTestStat = Infinity; // Log(infinity) essentially
                } // If group.experienced is 0, contribution is 0

                if (group.notExperienced > 0 && expectedNotExperienced > 0) {
                    overallGTestStat += group.notExperienced * Math.log(group.notExperienced / expectedNotExperienced);
                } else if (expectedNotExperienced === 0 && group.notExperienced !== 0) {
                     overallGTestStat = Infinity; // Log(infinity) essentially
                } // If group.notExperienced is 0, contribution is 0
            }
        });
        overallGTestStat *= 2; // Final step for G-Test


        const chiSquareP = isFinite(overallChiSquareStat) ? chiSquarePValue(overallChiSquareStat, degreesOfFreedom) : 0; // P-value is 0 if stat is Infinity
        const gTestP = isFinite(overallGTestStat) ? chiSquarePValue(overallGTestStat, degreesOfFreedom) : 0; // P-value is 0 if stat is Infinity

        const interpretation = (p: number) => p < alpha ?
            "Statistically different. Potential disparity; pursue further investigation." :
            "Not statistically different.";

        overallStats = {
            degreesOfFreedom,
            numComparisons,
            chiSquare: {
                statistic: overallChiSquareStat,
                pValue: chiSquareP,
                interpretation: interpretation(chiSquareP),
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

    // --- Calculate Pairwise Comparisons with Bonferroni Correction ---
    const pairwiseResults: PairwiseResult[] = [];
    if (numGroups >= 2 && overallStats) { // Only proceed if groups exist and overall stats calculated
         const bonferroniAlpha = alpha / overallStats.numComparisons; // Adjusted alpha for pairwise tests

        for (let i = 0; i < numGroups; i++) {
            for (let j = i + 1; j < numGroups; j++) {
                const group1 = observedData[i];
                const group2 = observedData[j];
                const pairIdentifier = `${group1.name} vs ${group2.name}`;
                let result: Partial < PairwiseResult > = {
                    group1: group1.name,
                    group2: group2.name
                };

                try {
                     // Create 2x2 table for the pair
                     const table: number[][] = [
                        [group1.experienced, group1.notExperienced],
                        [group2.experienced, group2.notExperienced],
                     ];

                      // Check if any cell makes the table invalid for chi-square (e.g., negative counts handled earlier)
                     // Check for zero rows/columns if needed, though calculate2x2ChiSquare handles internal zeros.
                     if (group1.rowTotal === 0 || group2.rowTotal === 0) {
                        throw new Error("One group in the pair has zero observations.");
                     }


                     // Calculate pairwise Chi-square (consider with and without Yates')
                     // For the main pairwise table, usually *don't* use Yates' unless specified.
                     // The image shows separate Yates results, suggesting it's a distinct calculation.
                     // Let's provide the standard pairwise chi-square here.
                     const { statistic: chiSqStatPair } = calculate2x2ChiSquare(table, false); // Standard Chi-Square for pairwise
                     const pValueRaw = isFinite(chiSqStatPair) ? chiSquarePValue(chiSqStatPair, 1) : 0; // df=1 for 2x2

                     // Apply Bonferroni correction: Multiply p-value by num comparisons, cap at 1.0
                     const correctedPValue = Math.min(1.0, pValueRaw * overallStats.numComparisons);
                     const isSignificant = correctedPValue < alpha; // Compare corrected p-value to original alpha


                     result = {
                        ...result,
                        pValue: pValueRaw,
                        correctedPValue: correctedPValue,
                        isSignificant: isSignificant,
                     };

                } catch (e: any) {
                    console.error(`Error calculating pairwise comparison for ${pairIdentifier}:`, e);
                    result.error = `Calculation error: ${e.message}`;
                     result.pValue = NaN;
                     result.correctedPValue = NaN;
                     result.isSignificant = false;
                }
                 pairwiseResults.push(result as PairwiseResult); // Cast as full type
            }
        }
    }


    return {
        observedData,
        overallStats,
        pairwiseResults,
        errors
    };
}
