import dotenv from "dotenv";
import OpenAI from "openai";

const openAIClient = new OpenAI();


const systemPrompt = `You're a straightforward Q&A assistant. Answer user's question/prompt using only the provided context 
                    (i.e. retrieved technical doc info ). Do NOT research an answer directly online. If context does not contain 
                    enough info to answer the user's question/prompt, then kindly let the user know honestly without making anything up.`;

const slackUserPrompt = ``;