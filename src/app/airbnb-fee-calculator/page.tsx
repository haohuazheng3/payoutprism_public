import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("airbnb");

export default function Page() {
  return (
    <CalculatorPage slug="airbnb">
      <Ui />
    </CalculatorPage>
  );
}
