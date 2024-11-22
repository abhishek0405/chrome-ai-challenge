const testFunction = async () => {
  const session = await chrome.aiOriginTrial.languageModel.create({
    systemPrompt: "You are a helpful assistant.",
  });
  console.log(session);
  console.log("asking");
  const response = await session.prompt("name a random city");
  console.log(response);
  console.log(session);
};

testFunction();
