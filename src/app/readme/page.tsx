
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function ReadmePage() {
  return (
    <main className="container mx-auto p-4 md:p-8 max-w-4xl">
        <Link href="/" className="mb-6 inline-block">
           <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Calculator
           </Button>
        </Link>
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl text-primary">
            About the Statistically Significant Calculator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-foreground">
          <section>
            <h2 className="text-xl font-semibold mb-2 text-secondary-foreground">Purpose</h2>
            <p>
              The Statistically Significant: Disparity Calculator is a web-based tool designed to analyze categorical data (typically representing different groups or demographics) and determine if there are statistically significant differences in the rate at which an outcome is experienced between these groups. It&apos;s particularly useful for identifying potential disparities or inequalities in areas like hiring, loan approvals, healthcare outcomes, or any scenario involving binary outcomes across defined categories.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-secondary-foreground">How It Works</h2>
            <p>
              The calculator takes user-provided counts for different categories, specifically the number of individuals within each category who experienced a particular outcome and the number who did not. Based on this input, it performs several statistical tests to assess overall and pairwise differences.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-secondary-foreground">Key Metrics & Calculations</h2>
            <ul className="list-disc space-y-3 pl-5">
              <li>
                <strong>Contingency Table Summary:</strong> The calculator first constructs a contingency table (k×2, where k is the number of categories). It displays:
                <ul className="list-circle space-y-1 pl-5 mt-1">
                  <li>Observed counts (# Experienced, # Not Experienced, Row Total) for each category.</li>
                  <li>The percentage of individuals in each category who experienced the outcome.</li>
                  <li>Expected counts under the null hypothesis (assuming no difference between groups).</li>
                  <li>Each category&apos;s contribution to the overall Chi-square statistic (O-E)²/E.</li>
                </ul>
              </li>
              <li>
                <strong>Overall Tests:</strong> It performs three tests on the overall contingency table to check for any significant difference across all categories simultaneously:
                <ul className="list-circle space-y-1 pl-5 mt-1">
                  <li>Chi-Square Test (Pearson): The standard test for independence in contingency tables. Calculates a test statistic and p-value.</li>
                  <li>Chi-Square Test (Yates&apos; Correction): A variation of the Chi-square test, often used for 2x2 tables but applied here for comparison, which adjusts the formula slightly.</li>
                  <li>G-Test (Likelihood Ratio): An alternative test based on likelihood ratios, often preferred when expected counts are low.</li>
                  <li>Degrees of Freedom (df): Calculated as k - 1, used to determine the p-value for the overall tests.</li>
                </ul>
                The interpretation (&quot;Statistically different&quot; or &quot;Not statistically different&quot;) is based on comparing the calculated p-value against the user-defined Significance Level (α).
              </li>
              <li>
                <strong>Pairwise Chi-Square Comparisons:</strong> To pinpoint which specific pairs of categories differ significantly, the calculator performs a 2x2 Chi-square test for every possible pair.
              </li>
              <li>
                <strong>Bonferroni Correction:</strong> Because multiple comparisons increase the chance of false positives, the significance level (α) is adjusted using the Bonferroni method (α_bonf = α / C, where C is the total number of pairwise comparisons).
              </li>
              <li>
                <strong>Results Matrix:</strong> The Bonferroni-corrected p-values for all pairs are displayed in a matrix. Significant p-values (less than α_bonf) are highlighted, indicating a potential disparity between that specific pair of groups.
              </li>
              <li>
                <strong>Comparison to Reference Categories:</strong> The tool allows users to select one or more categories as a reference. It then displays the pairwise comparison results specifically between each non-reference group and the selected reference group(s), making it easy to focus on disparities relative to a baseline or majority group.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-secondary-foreground">Functionalities</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li><strong>Dynamic Input Form:</strong> Add, remove, and name categories. Input the counts for &quot;Experienced Outcome&quot; and &quot;Did Not Experience Outcome&quot; for each category.</li>
              <li><strong>Significance Level (α):</strong> Set the threshold for statistical significance (default is 0.05). Results update dynamically when changed.</li>
              <li><strong>Reference Category Selection:</strong> Choose one or more categories to serve as the baseline for focused comparisons using checkboxes.</li>
              <li><strong>Statistical Report Tab:</strong> View the detailed results, including the Contingency Table Summary, Overall Test Statistics, the Pairwise Comparison Matrix, and Comparisons to Selected Reference(s).</li>
              <li><strong>Input Validation:</strong> Provides feedback for invalid inputs (e.g., non-numeric counts, alpha outside range, insufficient categories).</li>
              <li><strong>Interpretation Guidance:</strong> Provides brief textual interpretations alongside p-values to help understand the results.</li>
              <li><strong>CSV Export:</strong> Download the input parameters and the full statistical report (all tables and results) as a comma-separated values file.</li>
              <li><strong>PDF Export:</strong> Download a snapshot of the generated statistical report section as a PDF document.</li>
              <li><strong>Reset Form:</strong> Clear all inputs and results to start a new analysis.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-secondary-foreground">Disclaimer</h2>
            <p className="italic text-muted-foreground">
              This tool provides statistical analysis based on the data entered. The interpretations (&quot;Statistically different&quot; or &quot;Not statistically different&quot;) are based purely on the chosen significance level (α). Statistical significance does not automatically imply practical significance or causality. Always consider the context, potential confounding factors, and domain expertise when interpreting results. This tool should be used for informational and exploratory purposes, not as a sole basis for decision-making.
            </p>
          </section>
        </CardContent>
      </Card>
       <div className="mt-6 text-center">
          <Link href="/">
             <Button variant="outline">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to Calculator
             </Button>
          </Link>
       </div>
    </main>
  );
}
