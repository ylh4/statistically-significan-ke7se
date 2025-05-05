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
// Based on Abramowitz and Stegun formula 26.2.23
// Reasonably accurate for p between 0.001 and 0.999
function invNormCDF(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  if (p === 0.5) return 0;

  // Adjust p for two-tailed test (we want the upper critical value)
  const targetP = 1 - p; // e.g., for alpha=0.05, p=0.025, targetP=0.975
  const q = targetP < 0.5 ? targetP : 1 - targetP; // Use the smaller tail area for calculation

  const t = Math.sqrt(-2 * Math.log(q));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  let x = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t);

  // If we used the lower tail (targetP < 0.5), negate the result
  if (targetP < 0.5) {
    x = -x;
  }

  return x;
}


export function calculateDisparity(inputs: CalculationInputs): CalculationResult[] {
  const { N, alpha, categories, referenceCategoryName } = inputs;
  const results: CalculationResult[] = [];

  // Basic Validations
  if (N < 30) {
    throw new Error("Total Sample Size (N) must be at least 30.");
  }
  if (alpha <= 0 || alpha >= 1) {
    throw new Error("Significance Level (α) must be between 0 and 1.");
  }
  const totalCount = categories.reduce((sum, cat) => sum + cat.count, 0);
  if (totalCount !== N) {
    throw new Error(`Sum of category counts (${totalCount}) must equal Total Sample Size (N = ${N}).`);
  }
  const referenceCategory = categories.find(cat => cat.name === referenceCategoryName);
  if (!referenceCategory) {
    throw new Error(`Reference category "${referenceCategoryName}" not found in the category list.`);
  }
  if (categories.some(cat => cat.count < 0)) {
      throw new Error("Category counts cannot be negative.");
  }

  const pRef = referenceCategory.count / N;
  const zCrit = invNormCDF(alpha / 2); // Critical Z for two-tailed test

  if (isNaN(zCrit)) {
    throw new Error("Could not calculate critical Z-value. Check significance level.")
  }

  categories.forEach(category => {
    // Skip the reference category itself
    if (category.name === referenceCategoryName) {
      return;
    }

    try {
        const pi = category.count / N;
        const delta = pi - pRef;

        // Check for edge cases where proportions are 0 or 1
        const varPi = pi * (1 - pi) / N;
        const varPRef = pRef * (1 - pRef) / N;

        // Handle cases where variance might be zero or negative (due to floating point issues or p=0/1)
        const safeVarPi = Math.max(0, varPi);
        const safeVarPRef = Math.max(0, varPRef);

        const SE = Math.sqrt(safeVarPi + safeVarPRef);

        // Avoid division by zero if SE is zero (occurs if both pi and pRef are 0 or 1)
        const zStat = SE === 0 ? 0 : delta / SE;

        const ciMargin = zCrit * SE;
        const ciLow = delta - ciMargin;
        const ciHigh = delta + ciMargin;

        const isSignificant = Math.abs(zStat) > zCrit;

        results.push({
        categoryName: category.name,
        pi,
        pRef,
        delta,
        SE,
        zStat,
        ciLow,
        ciHigh,
        isSignificant,
        });
    } catch (e: any) {
         results.push({
            categoryName: category.name,
            pi: NaN,
            pRef: pRef,
            delta: NaN,
            SE: NaN,
            zStat: NaN,
            ciLow: NaN,
            ciHigh: NaN,
            isSignificant: false,
            error: `Error calculating for ${category.name}: ${e.message || 'Unknown error'}`
        });
    }
  });

  return results;
}
