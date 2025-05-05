import DisparityCalculator from '@/components/disparity-calculator';

export default function Home() {
  return (
    <main className="container mx-auto p-4 md:p-8">
       <h1 className="text-3xl font-bold mb-6 text-center text-primary">
          Statistically Significant: Disparity Calculator
        </h1>
      <DisparityCalculator />
    </main>
  );
}
