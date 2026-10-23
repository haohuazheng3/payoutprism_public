export const CONTACT_TOPICS = [
  { value: "wrong-fee", label: "A fee looks wrong or changed" },
  { value: "new-calculator", label: "Request a calculator" },
  { value: "feedback", label: "Feedback on the site" },
  { value: "press", label: "Press or partnership" },
  { value: "other", label: "Something else" },
] as const;

export const CONTACT_TOPIC_VALUES = CONTACT_TOPICS.map((t) => t.value) as unknown as [
  (typeof CONTACT_TOPICS)[number]["value"],
  ...(typeof CONTACT_TOPICS)[number]["value"][],
];
