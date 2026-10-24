import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("cars-and-bids");

export default function Page() {
  return (
    <CalculatorPage slug="cars-and-bids">
      <Ui />
    </CalculatorPage>
  );
}
