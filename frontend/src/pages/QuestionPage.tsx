import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import QuestionItem from "../components/QuestionItem";
import { fetchQuestions } from "../api/questionApi";
import { fetchLookupTable } from "../api/lookupApi";

type LookupTable = { [key: string]: number };

type Question = {
  key: string;
  question: string;
  options: { value: number; label: string }[];
};

function QuestionPage() {
  const [lookupTable, setLookupTable] = useState<LookupTable | null>(null);
  const [requiredQuestions, setRequiredQuestions] = useState<Question[]>([]);
  const [optionalQuestions, setOptionalQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionalQuestions, setSelectedOptionalQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<{ key: string; value: number }[]>([]);
  
  const navigate = useNavigate();

  useEffect(() => {
    // Get look-up table from backend
    fetchLookupTable().then(setLookupTable);

    fetchQuestions()
      .then((data) => {
        const required = data.slice(0, 4);
        const optional = data.slice(4, 7);
        setRequiredQuestions(required);
        setOptionalQuestions(optional);
      })
      .catch((error) => console.error("Error loading questions:", error));
  }, []);

  useEffect(() => {
    if (lookupTable && Object.keys(lookupTable).length === 1 && lookupTable["empty"] === 0) {
      console.log("모든 덱을 보유한 유저입니다. /no-results로 이동합니다.");
      navigate("/no-results");
    }
  }, [lookupTable, navigate]);

  const generateAnswerKey = (answers: { key: string; value: number | null }[]) => {
    const filteredAnswers = answers.filter(({ value }) => value !== null && value !== undefined);
    if (filteredAnswers.length === 0) return "empty";
    return filteredAnswers
      .map(({ key, value }) => `${key}=${value}`)
      .sort()
      .join("|");
  };

  const handleSelectOptionalQuestion = (question: Question) => {
    if (!answers.some((a) => a.key === question.key)) {
      setSelectedOptionalQuestions([question]);
    }
  };
  
  // Get # of hidden questions that have only 1 available answer
  // or 2 available answers including "상관 없음"
  const getHiddenQuestionsCount = () => {
    return optionalQuestions.filter((question) => {
      if (answers.some((a) => a.key === question.key)) return false;
  
      const availableOptions = getAvailableOptions(question);
      return availableOptions.length <= 1;
    }).length;
  };
  

  const getAvailableOptions = (question: Question) => {
    if (!lookupTable) return [];

    let validOptions = question.options.filter((option) => {
      const newAnswers = [...answers, { key: question.key, value: option.value }];
      return generateAnswerKey(newAnswers) in lookupTable;
    });

    console.log(validOptions);
  
    // Remove "상관 없음" if the question has only two answers
    if (validOptions.length === 2) {
      validOptions = validOptions.filter(o => o.label !== "상관 없음");
    }
  
    return validOptions;
  };
  

  const getValidOptionalQuestions = () => {
    return optionalQuestions.filter(
      (question) => getAvailableOptions(question).length > 1 || answers.some((a) => a.key === question.key)
    );
  };

  const handleAnswer = (questionKey: string, value: number) => {
    setAnswers((prev) => [...prev, { key: questionKey, value }]);
    setCurrentIndex((prev) => prev + 1);
    setSelectedOptionalQuestions([]);
  };

  const handleGoBack = () => {
    if (answers.length === 0) return;

    const lastAnswer = answers[answers.length - 1];
    const isRequired = requiredQuestions.some((q) => q.key === lastAnswer.key);
    const isOptional = optionalQuestions.some((q) => q.key === lastAnswer.key);

    // case 1: In selected question, just go to question selection page
    if (selectedOptionalQuestions.length > 0) {
        setSelectedOptionalQuestions([]);
        return;
    }

    // case 2: In question selection page and previous question is optional,
    // go back to that question and remove recent answer
    if (!isRequired && isOptional) {
        setAnswers((prev) => prev.slice(0, -1));
        setSelectedOptionalQuestions(optionalQuestions.filter((q) => q.key === lastAnswer.key));
        return;
    }

    // case 3: In selection page or question page and previous question is required.
    if (isRequired && !isOptional) {
        setAnswers((prev) => prev.slice(0, -1));
        setCurrentIndex(answers.length - 1);
    }

    // case 4: Do nothing
    if (!isRequired && !isOptional) {
        return;
    }
  };
  
  useEffect(() => {
    if (!lookupTable || Object.keys(lookupTable).length === 0) return;
    
    const totalQuestions = requiredQuestions.length + optionalQuestions.length;
    const answeredAndHiddenCount = answers.length + getHiddenQuestionsCount();
    const answerKey = generateAnswerKey(answers);
  
    console.log("응답한 질문 개수:", answers.length);
    console.log("비활성화된 질문 개수:", getHiddenQuestionsCount());
    console.log("전체 질문 개수:", totalQuestions);
    console.log("현재 answerKey:", answerKey);
    console.log("lookup table에서 찾은 값:", lookupTable[answerKey]);
  
    if (answeredAndHiddenCount >= totalQuestions) {
      console.log("더 이상 답할 수 있는 질문이 없음. 결과 페이지로 이동합니다.");
      localStorage.setItem("answerKey", answerKey);
      navigate("/result");
      return;
    }
  
    if (lookupTable[answerKey] === 1) { 
      console.log("answerKey가 유효한 값(1)임. 결과 페이지로 이동합니다.");
      localStorage.setItem("answerKey", answerKey);
      navigate("/result");
    }
  }, [answers, lookupTable, navigate, requiredQuestions, optionalQuestions]);
  
  return (
    <div className="mb-4 p-4 text-left h-auto min-h-screen flex flex-col items-center">
      <div className="mt-6 w-full max-w-lg">
        {currentIndex < requiredQuestions.length ? (
          <QuestionItem
            key={requiredQuestions[currentIndex].key}
            question={requiredQuestions[currentIndex].question}
            options={getAvailableOptions(requiredQuestions[currentIndex])}
            selectedValue={answers.find((a) => a.key === requiredQuestions[currentIndex].key)?.value}
            onSelect={(value) => handleAnswer(requiredQuestions[currentIndex].key, value)}
          />
        ) : selectedOptionalQuestions.length > 0 ? (
          <QuestionItem
            key={selectedOptionalQuestions[0].key}
            question={selectedOptionalQuestions[0].question}
            options={getAvailableOptions(selectedOptionalQuestions[0])}
            selectedValue={answers.find((a) => a.key === selectedOptionalQuestions[0].key)?.value}
            onSelect={(value) => handleAnswer(selectedOptionalQuestions[0].key, value)}
          />
        ) : (
          <div>
            <h3 className="mb-4 text-lg font-semibold space-y-4 text-gray-900 dark:text-white">
              다음 질문을 골라 주세요
            </h3>
            <div className="flex flex-col items-center space-y-4 w-full">
              {getValidOptionalQuestions().length > 0 ? (
                getValidOptionalQuestions().map((q) => {
                  const isAnswered = answers.some((a) => a.key === q.key);

                  return (
                    <button
                      key={q.key}
                      className={`px-4 py-2 rounded-lg transition break-keep w-full max-w-2xl text-center
                        ${
                          isAnswered
                            ? "bg-gray-300 text-gray-600 cursor-not-allowed dark:bg-gray-600 dark:text-gray-400"
                            : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 hover:dark:bg-gray-600 dark:text-gray-100"
                        }`}
                      onClick={() => handleSelectOptionalQuestion(q)}
                      disabled={isAnswered}
                    >
                      {q.question}
                    </button>
                  );
                })
              ) : (
                <p className="text-gray-500 dark:text-gray-400">선택할 수 있는 추가 질문이 없습니다.</p>
              )}
            </div>
          </div>
        )}
      </div>
      <button
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        onClick={handleGoBack}
        disabled={answers.length === 0}
      >
        뒤로 가기
      </button>
    </div>
  );
}

export default QuestionPage;
