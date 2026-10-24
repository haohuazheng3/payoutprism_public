import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("bring-a-trailer");

export default function Page() {
  return (
    <CalculatorPage slug="bring-a-trailer">
      <Ui />
    </CalculatorPage>
  );
}
