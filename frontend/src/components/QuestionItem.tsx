type QuestionProps = {
  question: string;
  options: { value: number; label: string }[];
  selectedValue?: number | number[];
  onSelect: (value: number) => void;
};

function QuestionItem({ question, options, selectedValue, onSelect }: QuestionProps) {
  return (
    <div className="mb-6 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{question}</h2>
      <div className="flex flex-col items-center space-y-4 w-full">
        {options.map((option) => {
          const isSelected = Array.isArray(selectedValue)
            ? selectedValue.includes(option.value)
            : selectedValue === option.value;

          return (
            <button
              key={option.value}
              className={`px-4 py-2 rounded-lg transition break-keep w-full max-w-2xl text-center 
                ${
                  isSelected
                    ? "bg-blue-500 text-white dark:bg-blue-400"
                    : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 hover:dark:bg-gray-600 dark:text-gray-100"
                }`}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default QuestionItem;
