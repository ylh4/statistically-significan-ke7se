"use client";

import type { ChangeEvent, FormEvent } from 'react';
import React, { useState, useEffect, useMemo } from 'react';
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, PlusCircle, Download, RotateCcw, AlertCircle } from 'lucide-react';
import { calculateDisparity, type CalculationResult, type Category } from "@/lib/calculations";
import { exportToCSV } from '@/lib/utils';
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";


// --- Zod Schema Definition ---
const categorySchema = z.object({
  name: z.string().min(1, "Category name cannot be empty"),
  count: z.coerce // Use coerce to convert input string to number
    .number({ invalid_type_error: "Count must be a number" })
    .int("Count must be an integer")
    .nonnegative("Count cannot be negative"),
});

const formSchema = z.object({
  N: z.coerce
    .number({ invalid_type_error: "Total Sample Size must be a number" })
    .int("Total Sample Size must be an integer")
    .positive("Total Sample Size must be positive")
    .min(30, "Total Sample Size (N) must be at least 30"),
  alpha: z.coerce
    .number({ invalid_type_error: "Significance Level must be a number" })
    .positive("Significance Level must be positive") // Ensures > 0
    .lt(1, "Significance Level must be less than 1"), // Ensures < 1
  categories: z.array(categorySchema).min(2, "At least two categories are required"),
  referenceCategoryName: z.string().min(1, "Please select a reference category"),
}).refine(data => {
    // Ensure N is a valid number before proceeding
    if (isNaN(data.N)) return false;
    const totalCount = data.categories.reduce((sum, cat) => sum + (isNaN(cat.count) ? 0 : cat.count), 0);
    return totalCount === data.N;
}, {
    message: "Sum of category counts must equal Total Sample Size (N)",
    path: ["categories"], // Attach error to the categories field array level or a general path
});

type FormValues = z.infer<typeof formSchema>;


// --- Component ---
export default function DisparityCalculator() {
  const { toast } = useToast();
  const [results, setResults] = useState<CalculationResult[]>([]);
  const [calculationError, setCalculationError] = useState<string | null>(null);

   const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      N: 100, // Sensible default
      alpha: 0.05,
      categories: [
        { name: "Group A", count: 50 },
        { name: "Group B", count: 50 },
      ],
      referenceCategoryName: "",
    },
     mode: "onChange", // Validate on change for inline feedback
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "categories",
  });

  const watchCategories = form.watch("categories");
  const watchN = form.watch("N");
  const watchReference = form.watch("referenceCategoryName");

   // Update reference category options when categories change
  const categoryOptions = useMemo(() => {
    return watchCategories.map((cat) => cat.name).filter(name => name?.trim());
  }, [watchCategories]);

  // Reset reference category if it's removed or name changes drastically
  useEffect(() => {
    if (watchReference && !categoryOptions.includes(watchReference)) {
      form.setValue("referenceCategoryName", "");
    }
  }, [categoryOptions, watchReference, form]);

  // Recalculate total count for validation feedback
   const currentTotalCount = useMemo(() => {
     // Ensure counts are treated as numbers, default to 0 if invalid
     return watchCategories.reduce((sum, cat) => sum + (isNaN(cat.count) ? 0 : Number(cat.count)), 0);
   }, [watchCategories]);

   // Check if N is a valid number before comparing
   const nValue = typeof watchN === 'number' && !isNaN(watchN) ? watchN : 0;
   const countMatchesN = nValue > 0 && currentTotalCount === nValue;

  const onSubmit = (data: FormValues) => {
    setCalculationError(null);
    setResults([]); // Clear previous results
    try {
      // **Phase C Integration Point:**
      // Replace this direct call with an API fetch in the future
      // For now, we call the calculation function directly
      const calculatedResults = calculateDisparity({
        N: data.N,
        alpha: data.alpha,
        categories: data.categories,
        referenceCategoryName: data.referenceCategoryName,
      });
      setResults(calculatedResults);
       toast({
            title: "Calculation Successful",
            description: "Disparity results have been generated.",
       });

      // Check for individual calculation errors within results
       const errorsInResults = calculatedResults.filter(r => r.error);
        if (errorsInResults.length > 0) {
             setCalculationError(`Errors occurred during calculation for: ${errorsInResults.map(r => r.categoryName).join(', ')}. See table for details.`);
             toast({
                title: "Calculation Warning",
                description: "Some categories could not be calculated. See table.",
                variant: "destructive",
             });
        }

    } catch (error: any) {
      console.error("Calculation failed:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during calculation.";
      setCalculationError(errorMessage);
       toast({
            title: "Calculation Failed",
            description: errorMessage,
            variant: "destructive",
       });
    }
  };

  const handleReset = () => {
    form.reset();
    setResults([]);
    setCalculationError(null);
     toast({
        title: "Form Reset",
        description: "All inputs and results have been cleared.",
     });
  };

  const handleExport = () => {
      if (results.length === 0) {
           toast({
                title: "Export Failed",
                description: "No results to export.",
                variant: "destructive",
           });
          return;
      }
    try {
        exportToCSV(results);
         toast({
            title: "Export Successful",
            description: "Results exported to CSV.",
         });
    } catch (error) {
        console.error("CSV Export failed:", error);
         toast({
            title: "Export Failed",
            description: "Could not export results to CSV.",
            variant: "destructive",
         });
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto shadow-lg">
       <Toaster />
      <CardHeader>
        <CardTitle className="text-2xl text-secondary-foreground">Input Parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* N and Alpha Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="space-y-2">
              <Label htmlFor="N">Total Sample Size (N)</Label>
              <Input
                id="N"
                type="number"
                min="30" // Keep browser min for usability, Zod enforces >= 30
                step="1"
                {...form.register("N")}
                className={cn(form.formState.errors.N ? "border-destructive" : "")}
              />
              {form.formState.errors.N && <p className="text-sm text-destructive">{form.formState.errors.N.message}</p>}
            </div>
             <div className="space-y-2">
              <Label htmlFor="alpha">Significance Level (α)</Label>
              <Input
                id="alpha"
                type="number"
                // Remove min/max/step to rely primarily on Zod and allow easier typing
                // placeholder="e.g., 0.05" // Optional placeholder
                {...form.register("alpha")}
                 className={cn(form.formState.errors.alpha ? "border-destructive" : "")}
              />
               {form.formState.errors.alpha && <p className="text-sm text-destructive">{form.formState.errors.alpha.message}</p>}
            </div>
          </div>

          {/* Categories Section */}
          <div className="space-y-4">
            <Label className="text-lg font-medium text-secondary-foreground">Categories</Label>
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2 p-3 border rounded-md bg-card">
                <div className="flex-1 grid grid-cols-2 gap-2">
                     <div className="space-y-1">
                       <Label htmlFor={`categories.${index}.name`}>Name</Label>
                        <Input
                        id={`categories.${index}.name`}
                        {...form.register(`categories.${index}.name`)}
                         className={cn(form.formState.errors.categories?.[index]?.name ? "border-destructive" : "")}
                        />
                         {form.formState.errors.categories?.[index]?.name && <p className="text-sm text-destructive">{form.formState.errors.categories?.[index]?.name?.message}</p>}
                     </div>
                     <div className="space-y-1">
                        <Label htmlFor={`categories.${index}.count`}>Count</Label>
                        <Input
                        id={`categories.${index}.count`}
                        type="number"
                        min="0" // Keep non-negative constraint
                        step="1"
                        {...form.register(`categories.${index}.count`)}
                        className={cn(form.formState.errors.categories?.[index]?.count ? "border-destructive" : "")}
                        />
                        {form.formState.errors.categories?.[index]?.count && <p className="text-sm text-destructive">{form.formState.errors.categories?.[index]?.count?.message}</p>}
                     </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={fields.length <= 2}
                  className="mt-6 text-destructive hover:bg-destructive/10"
                  aria-label="Remove category"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => append({ name: `Group ${String.fromCharCode(65 + fields.length)}`, count: 0 })}
              className="mt-2"
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Add Category
            </Button>

             {/* Validation message for sum of counts */}
              {!countMatchesN && watchCategories.length > 0 && nValue > 0 && (
                 <p className="text-sm text-destructive">
                    Sum of counts ({currentTotalCount}) does not match Total Sample Size ({nValue || 'N/A'}).
                 </p>
              )}
              {/* Display root level error if refine fails */}
             {form.formState.errors.categories?.root && <p className="text-sm text-destructive">{form.formState.errors.categories.root.message}</p>}
             {/* Display general message if not attached to root */}
             {form.formState.errors.categories && typeof form.formState.errors.categories.message === 'string' && !form.formState.errors.categories.root && <p className="text-sm text-destructive">{form.formState.errors.categories.message}</p>}


          </div>

            {/* Reference Category Selection */}
            <div className="space-y-2">
                <Label htmlFor="referenceCategoryName">Reference Category</Label>
                 <Controller
                    control={form.control}
                    name="referenceCategoryName"
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value} >
                            <SelectTrigger id="referenceCategoryName" className={cn(form.formState.errors.referenceCategoryName ? "border-destructive" : "")}>
                                <SelectValue placeholder="Select reference category" />
                            </SelectTrigger>
                            <SelectContent>
                                {categoryOptions.map(name => (
                                <SelectItem key={name} value={name}>
                                    {name}
                                </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                     )}
                    />
                 {form.formState.errors.referenceCategoryName && <p className="text-sm text-destructive">{form.formState.errors.referenceCategoryName.message}</p>}
            </div>


          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row justify-end gap-4 pt-4">
             <Button type="button" variant="outline" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reset Form
            </Button>
            <Button type="submit" disabled={!form.formState.isValid} className="bg-primary hover:bg-accent text-primary-foreground">
              Calculate Disparity
            </Button>
          </div>
        </form>
      </CardContent>

      {/* Results Section */}
      {(results.length > 0 || calculationError) && (
        <CardFooter className="flex-col items-start gap-4 pt-6 border-t">
           <div className="flex justify-between w-full items-center">
             <h2 className="text-xl font-semibold text-secondary-foreground">Results</h2>
              <Button
                    type="button"
                    variant="outline"
                    onClick={handleExport}
                    disabled={results.length === 0}
                    className="ml-auto"
                >
                    <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
           </div>

          {calculationError && (
            <Alert variant="destructive" className="w-full">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Calculation Error</AlertTitle>
              <AlertDescription>{calculationError}</AlertDescription>
            </Alert>
          )}

          {results.length > 0 && (
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader className="bg-secondary">
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>pᵢ</TableHead>
                    <TableHead>p<sub className="text-xs">ref</sub></TableHead>
                    <TableHead>δ (Difference)</TableHead>
                    <TableHead>SE</TableHead>
                    <TableHead>z-statistic</TableHead>
                    <TableHead>CI Low</TableHead>
                    <TableHead>CI High</TableHead>
                    <TableHead>Significant?</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((result) => (
                    <TableRow
                      key={result.categoryName}
                      className={cn(
                        result.isSignificant && result.delta > 0 && "significant-red", // Red for positive significant diff
                        result.isSignificant && result.delta < 0 && "significant-blue", // Blue for negative significant diff
                        !result.isSignificant && !result.error && "bg-muted/50", // Gray for non-significant
                        result.error && "bg-destructive/20" // Light red for rows with errors
                      )}
                    >
                      <TableCell className="font-medium">{result.categoryName}</TableCell>
                      <TableCell>{isNaN(result.pi) ? 'N/A' : result.pi.toFixed(4)}</TableCell>
                      <TableCell>{isNaN(result.pRef) ? 'N/A' : result.pRef.toFixed(4)}</TableCell>
                      <TableCell>{isNaN(result.delta) ? 'N/A' : result.delta.toFixed(4)}</TableCell>
                      <TableCell>{isNaN(result.SE) ? 'N/A' : result.SE.toFixed(4)}</TableCell>
                      <TableCell>{isNaN(result.zStat) ? 'N/A' : result.zStat.toFixed(4)}</TableCell>
                      <TableCell>{isNaN(result.ciLow) ? 'N/A' : result.ciLow.toFixed(4)}</TableCell>
                      <TableCell>{isNaN(result.ciHigh) ? 'N/A' : result.ciHigh.toFixed(4)}</TableCell>
                       <TableCell>
                         {result.error ? 'Error' : (result.isSignificant ? 'Yes' : 'No')}
                       </TableCell>
                      <TableCell className="text-xs text-destructive-foreground/80">
                        {result.error ? result.error : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
