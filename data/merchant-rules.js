export const merchantRules = [
  {
    words: ["이마트", "홈플러스", "롯데마트", "농협하나로", "마켓컬리"],
    category: "groceries",
  },
  {
    words: ["배달의민족", "요기요", "쿠팡이츠", "스타벅스", "투썸"],
    category: "dining",
  },
  {
    words: ["주유소", "하이패스", "코레일", "카카오택시"],
    category: "transport",
  },
  {
    words: ["넷플릭스", "유튜브", "skt", "kt통신", "lgu+", "디즈니플러스"],
    category: "subscription",
  },
  { words: ["보험"], category: "finance" },
  { words: ["어린이집", "유치원", "키즈"], category: "child" },
];
