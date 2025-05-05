export interface Category {
  name: string;
  count: number;
}

export interface CalculationInputs {
  N: number;
  alpha: number;
  categories: Category[];
  referenceCategoryName: string;
}

export interface CalculationResult {
  categoryName: string;
  pi: number;
  pRef: number;
  delta: number;
  SE: number;
  zStat: number;
  ciLow: number;
  ciHigh: number;
  isSignificant: boolean;
  error?: string; // Optional error message per category
}

// Approximation for the inverse standard normal CDF (Percent Point Function)
// Gives the Z-score for a given cumulative probability p.
// For a two-tailed test with significance alpha, we need the Z-score corresponding to 1 - alpha/2.
// Based on Abramowitz and Stegun formula 26.2.23
// Reasonably accurate for p between 0.001 and 0.999
export function invNormCDF(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  if (p === 0.5) return 0;

  // We want the Z-score such that P(Z <= z) = p
  const q = p < 0.5 ? p : 1 - p; // Use the smaller tail area for calculation accuracy

  if (q === 0) return p < 0.5 ? -Infinity : Infinity; // Handle edge case if p is very close to 0 or 1

  const t = Math.sqrt(-2 * Math.log(q));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  let x = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t);

  // If we used the lower tail (p < 0.5), negate the result to get the correct Z-score
  if (p < 0.5) {
    x = -x;
  }

  return x;
}


export function calculateDisparity(inputs: CalculationInputs): CalculationResult[] {
  const { N, alpha, categories, referenceCategoryName } = inputs;
  const results: CalculationResult[] = [];

  // Basic Validations moved to Zod schema where possible

  const referenceCategory = categories.find(cat => cat.name === referenceCategoryName);
  // Zod ensures N >= 30, alpha in range, counts >= 0, sum matches N, ref category exists

   if (!referenceCategory) {
     // This case should theoretically not happen if Zod validation passes, but added as a safeguard.
     throw new Error(`Reference category "${referenceCategoryName}" logic error.`);
   }
   if (referenceCategory.count === 0) {
      throw new Error(`Reference category "${referenceCategoryName}" has a count of 0, which is not suitable for comparison.`);
   }
   if (referenceCategory.count === N) {
       throw new Error(`Reference category "${referenceCategoryName}" has a count equal to N, leaving no variance for comparison.`);
   }


  const pRef = referenceCategory.count / N;
  // Calculate the critical Z-value for the upper tail of the two-tailed test
  const zCrit = invNormCDF(1 - alpha / 2);

  if (isNaN(zCrit)) {
    // This should also be less likely given alpha validation, but good to keep
    throw new Error("Could not calculate critical Z-value. Check significance level.")
  }

  categories.forEach(category => {
    // Skip the reference category itself
    if (category.name === referenceCategoryName) {
      return;
    }

    let pi: number | undefined = undefined;
    let delta: number | undefined = undefined;
    let SE: number | undefined = undefined;
    let zStat: number | undefined = undefined;
    let ciLow: number | undefined = undefined;
    let ciHigh: number | undefined = undefined;
    let isSignificant = false;
    let error: string | undefined = undefined;


    try {
        // Validations for count < 0 and count > N are technically handled by Zod and refine,
        // but keeping a check here might catch edge cases if form state somehow bypasses Zod momentarily.
        if (category.count < 0) {
             throw new Error("Count cannot be negative."); // Redundant with Zod, but safe
        }
         if (category.count > N) {
             throw new Error(`Count (${category.count}) cannot exceed Total Sample Size (N = ${N}).`); // Redundant with Zod refine, but safe
         }

        pi = category.count / N;
        delta = pi - pRef;

        // Check for edge cases where proportions are 0 or 1
        // Calculate variance, ensuring non-negativity
        const varPi = Math.max(0, pi * (1 - pi) / N);
        const varPRef = Math.max(0, pRef * (1 - pRef) / N);

        SE = Math.sqrt(varPi + varPRef);

        // Handle SE === 0 case
        if (SE === 0) {
            // If delta is also 0, it's not significant.
            if (delta === 0) {
                zStat = 0;
                ciLow = 0;
                ciHigh = 0;
                isSignificant = false;
            } else {
                // If delta is non-zero and SE is 0, it implies perfect separation (e.g., 0% vs 100%).
                // This is statistically significant. Assign Infinity Z-stat and CI collapses.
                zStat = delta > 0 ? Infinity : -Infinity;
                ciLow = delta;
                ciHigh = delta;
                isSignificant = true;
            }
        } else {
            // Standard calculation
            zStat = delta / SE;
            const ciMargin = zCrit * SE;
            ciLow = delta - ciMargin;
            ciHigh = delta + ciMargin;
             // Significance check: Compare absolute zStat to the positive critical value
            isSignificant = Math.abs(zStat) > zCrit;
        }


        // Final check for NaN on key results before pushing
        if ([pi, delta, SE, zStat, ciLow, ciHigh].some(isNaN)) {
             // Avoid pushing NaN if SE was 0 and handled correctly
             if (!((SE === 0) && [zStat, ciLow, ciHigh].every(val => val === 0 || val === delta || val === Infinity || val === -Infinity))) {
                throw new Error("Calculation resulted in unexpected NaN values.");
             }
        }

        results.push({
            categoryName: category.name,
            pi: pi!,
            pRef: pRef,
            delta: delta!,
            SE: SE!,
            zStat: zStat!,
            ciLow: ciLow!,
            ciHigh: ciHigh!,
            isSignificant,
        });

    } catch (e: any) {
         results.push({
            categoryName: category.name,
            pi: pi ?? NaN, // Use calculated value if available, else NaN
            pRef: pRef,
            delta: delta ?? NaN,
            SE: SE ?? NaN,
            zStat: zStat ?? NaN,
            ciLow: ciLow ?? NaN,
            ciHigh: ciHigh ?? NaN,
            isSignificant: false,
            error: `Error calculating for ${category.name}: ${e.message || 'Unknown error'}`
        });
    }
  });

  return results;
}
