// cloud-cost-dashboard-frontend/backend/index.js
// --- VERIFICATION TAG: v20250611_CLOUD_CAREER_GUIDE_BACKEND_FINAL ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Using GoogleGenerativeAI for Gemini

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Enable CORS for cross-origin requests from your frontend
app.use(express.json({ limit: '10mb' })); // For parsing application/json bodies, increased limit for potential larger contexts

// Gemini API Key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Ensure API key is set
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set in the .env file!");
  console.error("Please create a .env file in the backend directory with GEMINI_API_KEY='YOUR_API_KEY_HERE'");
  process.exit(1); // Exit if API key is missing
}

// Initialize Gemini Generative AI model
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const textOnlyModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using gemini-2.0-flash as specified

// Helper function to format CSV summary for Gemini insights
function formatSummaryForGemini(summary) {
  let prompt = "Analyze the following AWS billing data summary. Provide a **brief, actionable summary** of key cost optimization insights. Focus on **top 3-5 recommendations** only. Use bullet points for recommendations. Keep the overall response **under 200 words**.\n\n";

  prompt += `Overall Billing Period: ${summary.totalOverallCost ? 'Data available' : 'No data'}\n`;
  if (summary.totalOverallCost) {
    prompt += `Total Unblended Cost: $${summary.totalOverallCost}\n\n`;
  }

  if (summary.serviceCosts && summary.serviceCosts.length > 0) {
    prompt += "Top 5 Services by Cost:\n";
    summary.serviceCosts.forEach(([service, cost]) => {
      prompt += `- ${service}: $${cost.toFixed(2)}\n`;
    });
    prompt += "\n";
  }

  if (summary.topExpensiveResources && summary.topExpensiveResources.length > 0) {
    prompt += "Top 5 Expensive Individual Resources:\n";
    summary.topExpensiveResources.forEach(res => {
      prompt += `- Resource ID: ${res.resourceId || 'N/A'}, Service: ${res.service}, Cost: $${res.totalCost.toFixed(2)}, Usage Types: ${res.usageTypes}, Occurrences: ${res.occurrences}, Duration: ${res.durationDays} days\n`;
    });
    prompt += "\n";
  }

  if (summary.idleResources && summary.idleResources.length > 0) {
    prompt += "Potential Idle/Underutilized Resources (Low Cost/Usage):\n";
    summary.idleResources.forEach(res => {
      prompt += `- Resource ID: ${res.resourceId || 'N/A'}, Service: ${res.service}, Cost: $${res.totalCost.toFixed(2)}, Occurrences: ${res.occurrences}, Duration: ${res.durationDays} days\n`;
    });
    prompt += "\n";
  }

  if (summary.dataTruncated) {
    prompt += "Note: The provided data was a sample (first 50,000 rows) due to large file size. Comprehensive analysis might require full dataset processing.\n\n";
  }

  prompt += "Based on this summary, provide the most impactful cost-saving actions, keeping the response concise and under 200 words. Start directly with the summary/recommendations.\n";

  return prompt;
}

// --- API Routes ---

// Default route to check if backend is running
app.get('/', (req, res) => {
  res.send('Cloud Cost Dashboard Backend is running!');
});

// DIAGNOSTIC ROUTE (keep this here for testing)
app.get('/test-backend', (req, res) => {
    res.json({ message: 'Backend is reachable and test route works! Tag: v20250611_CLOUD_CAREER_GUIDE_BACKEND_FINAL' });
});


// Endpoint for general AI insights based on CSV summary
app.post('/api/ai/insights', async (req, res) => {
  const { csvSummary } = req.body;

  if (!csvSummary || Object.keys(csvSummary).length === 0) {
    return res.status(400).json({ error: 'No CSV summary provided for insights.' });
  }

  const prompt = formatSummaryForGemini(csvSummary);
  console.log("Sending prompt to Gemini (first 500 chars):", prompt.substring(0, 500) + "...");
  console.log("Full prompt length:", prompt.length);

  try {
    const result = await textOnlyModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 200, // Limit output tokens for concise insights
      },
    });
    const response = result.response;
    const text = response.text();

    res.json({
      insights: text,
      // Also return the summary data, as it might be used on the frontend
      totalOverallCost: csvSummary.totalOverallCost,
      serviceCosts: csvSummary.serviceCosts,
      topExpensiveResources: csvSummary.topExpensiveResources,
      idleResources: csvSummary.idleResources,
      dataTruncated: csvSummary.dataTruncated
    });

  } catch (error) {
    console.error('Error calling Gemini API for insights:', error.message);
    // Log more details if available from the Gemini API response
    if (error.response && error.response.candidates) {
        console.error("Gemini API Error details:", JSON.stringify(error.response.candidates, null, 2));
    }
    res.status(500).json({ error: 'Failed to get AI insights from Gemini. Check backend logs for details.', details: error.message });
  }
});

// Endpoint for AI cost estimation
app.post('/api/ai/estimate', async (req, res) => {
  const { resourceType, size, region, duration } = req.body;

  if (!resourceType || !size || !region || !duration) {
    return res.status(400).json({ error: 'Missing required fields for estimation.' });
  }

  const prompt = `You are an AWS solutions architect and cost estimator.
  A user wants to understand the estimated monthly cost for an TWS service or architecture based on the following description:
  "Estimate the monthly cost for an AWS ${resourceType} of size ${size} in the ${region} region, running for approximately ${duration} hours/month."

  Provide a high-level monthly cost estimate in USD. Break down the estimate by key AWS components (e.g., EC2, S3, RDS, Data Transfer). If possible, suggest the most common or default options for each component.
  State any assumptions made.
  If the request is too vague, ask for more details.
  Format the output as a clear estimate, starting with "Estimated Monthly Cost: $XXX.XX".
  `;

  try {
    const result = await textOnlyModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 150, // Limit output tokens for concise estimate
      },
    });
    const response = result.response;
    const text = response.text();
    res.json({ estimate: text });
  } catch (error) {
    console.error('Error estimating cost with Gemini:', error.message);
    res.status(500).json({ error: 'Failed to get cost estimate from Gemini.', details: error.message });
  }
});

// Endpoint for AI chat interactions (ENHANCED for general cloud questions)
app.post('/api/ai/chat', async (req, res) => {
  const { userQuestion, csvContext } = req.body; // csvContext can now be optional or minimal

  if (!userQuestion) {
    return res.status(400).json({ error: 'No user question provided.' });
  }

  let chatPrompt = `You are an expert AWS Cloud Operations and FinOps Assistant. Your goal is to help users understand, manage, and operate their AWS resources efficiently. Provide clear, concise, and accurate answers based on your extensive knowledge of AWS services, best practices (cost, security, operations), and common cloud concepts.`;

  // Conditionally add context if CSV data is available and potentially relevant
  if (csvContext && csvContext.hasData) {
    chatPrompt += `\n\nUser has uploaded AWS billing data. While your primary role is general cloud assistance, if the question seems related to their costs, you can infer context. Here's a brief indicator: Data exists for ${csvContext.numRowsProcessed} line items.`;
  }

  chatPrompt += `\n\nUser's question: "${userQuestion}"`;

  console.log("Sending general cloud chat prompt to Gemini (first 500 chars):", chatPrompt.substring(0, 500) + "...");
  console.log("Full chat prompt length:", chatPrompt.length);

  try {
    const result = await textOnlyModel.generateContent({
      contents: [{ role: "user", parts: [{ text: chatPrompt }] }],
      generationConfig: {
        maxOutputTokens: 300, // Increased tokens for more comprehensive general answers
        temperature: 0.5, // Balanced for informative and coherent responses
      },
    });
    const response = result.response;
    const text = response.text();
    res.json({ answer: text }); // Send the AI's answer back
  } catch (error) {
    console.error('Error calling Gemini API for chat:', error.message);
    if (error.response && error.response.candidates) {
        console.error("Gemini API Error details:", JSON.stringify(error.response.candidates, null, 2));
    }
    res.status(500).json({ error: 'Failed to get AI chat response.', details: error.message });
  }
});

// AI Recommendation for Cost Savings Panel
app.post('/api/ai/recommendation', async (req, res) => {
    const { promptContext } = req.body; // promptContext will describe the specific saving opportunity

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for recommendation is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `Provide a **single, extremely concise sentence or a maximum of two very short bullet points** with the most important actionable recommendation for this cloud cost optimization opportunity. Focus only on the primary step to take.` },
                    { text: `Opportunity Details: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 50, // Even further reduced for conciseness
                temperature: 0.2, // Lower temperature for less creativity, more directness
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ recommendation: text }); // Send the AI's recommendation back to the frontend
    } catch (error) {
        console.error('Error generating AI recommendation:', error);
        res.status(500).json({
            error: 'Failed to generate AI recommendation.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Anomaly Explanation Endpoint
app.post('/api/ai/explain-anomaly', async (req, res) => {
    const { promptContext } = req.body;

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for anomaly explanation is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an AWS cost forensic analyst, provide a **concise (1-3 sentences) explanation** for the likely root cause of the following cloud cost anomaly and suggest **one immediate investigation step**. Focus on the most probable reason based on the provided details.` },
                    { text: `Anomaly Details: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 100, // Concise explanation
                temperature: 0.4, // A bit more creative than recommendations, but still focused
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ explanation: text });
    } catch (error) {
        console.error('Error generating AI anomaly explanation:', error);
        res.status(500).json({
            error: 'Failed to generate AI anomaly explanation.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Resource Optimization Endpoint
app.post('/api/ai/resource-optimization', async (req, res) => {
    const { promptContext } = req.body;

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for resource optimization is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS resource optimization specialist, provide a **detailed, actionable plan (3-5 bullet points)** for the following cloud resource optimization opportunity. Focus on concrete steps a user can take.` },
                    { text: `Opportunity Details: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 200,
                temperature: 0.3,
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ optimizationPlan: text });
    } catch (error) {
        console.error('Error generating AI resource optimization plan:', error);
        res.status(500).json({
            error: 'Failed to generate AI resource optimization plan.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Troubleshooting Endpoint
app.post('/api/ai/troubleshoot', async (req, res) => {
    const { promptContext } = req.body;

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for troubleshooting is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As a Senior Cloud Support Engineer for AWS, analyze the following operational problem and provide:
                    1.  **Likely Causes:** 1-3 potential reasons for this problem.
                    2.  **Diagnostic Steps:** 2-3 immediate, actionable steps the user can take to investigate.
                    3.  **Common Solutions:** 1-2 common solutions if the problem is identified.
                    Format your response clearly with bolded headings for each section. Keep the overall response concise and directly focused on the problem.` },
                    { text: `User's Problem: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 250, // Allow a bit more for structured troubleshooting steps
                temperature: 0.4, // Balanced for informative and accurate troubleshooting
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ troubleshootResponse: text });
    } catch (error) {
        console.error('Error generating AI troubleshooting response:', error);
        res.status(500).json({
            error: 'Failed to generate AI troubleshooting response.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Architecture Assistant Endpoint
app.post('/api/ai/architecture-assistant', async (req, res) => {
    const { promptContext } = req.body; // user's architectural problem/goal

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for architecture assistant is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS Solutions Architect, provide guidance for the following cloud solution request. Your response should include:
                    1.  **Recommended AWS Services:** List 3-5 key services and briefly explain their role.
                    2.  **Conceptual Architecture:** Describe how these services would conceptually integrate at a high level.
                    3.  **Key Considerations:** Mention important aspects like scalability, security, main cost drivers, and reliability for this architecture.
                    Format your response clearly with bolded headings for each section. Keep the overall response comprehensive but concise.` },
                    { text: `User's Request: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 400, // Increased tokens for more detailed architectural guidance
                temperature: 0.7, // Slightly higher for more creative/diverse architectural suggestions
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ architectureGuidance: text });
    } catch (error) {
        console.error('Error generating AI architectural guidance:', error);
        res.status(500).json({
            error: 'Failed to generate AI architectural guidance.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Security and Compliance Endpoint
app.post('/api/ai/security-compliance', async (req, res) => {
    const { promptContext } = req.body; // user's security/compliance query

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for security and compliance is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS Security and Compliance Advisor, provide a concise and accurate answer to the following user query.
                    If the query is about best practices, list key actionable steps (1-3 bullet points).
                    If the query is about a compliance standard, briefly explain its relevance to AWS and key considerations.
                    Focus on practical, actionable advice. Provide your answer directly.` },
                    { text: `User's Query: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 200, // Balanced for concise but informative answers
                temperature: 0.3, // Lower temperature for more factual and direct responses
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ securityComplianceResponse: text });
    } catch (error) {
        console.error('Error generating AI security/compliance response:', error);
        res.status(500).json({
            error: 'Failed to generate AI security/compliance response.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Operations Playbook Generator Endpoint
app.post('/api/ai/generate-playbook', async (req, res) => {
    const { promptContext } = req.body; // user's operational scenario/task

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for playbook generation is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As a highly experienced AWS DevOps Engineer and SRE, generate a detailed, step-by-step operational playbook for the following AWS cloud scenario or task.
                    Your playbook should be actionable, logically ordered, and include considerations for best practices (e.g., security, scalability, monitoring, cost-efficiency) where relevant.
                    Structure the playbook with clear bolded headings for sections and numbered steps within each section. Start directly with the playbook, e.g., "Playbook for [Scenario Name]:".` },
                    { text: `Scenario/Task: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 600, // Increased tokens for comprehensive playbook steps
                temperature: 0.6, // Balanced for detailed yet structured output
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ playbook: text });
    } catch (error) {
        console.error('Error generating AI operational playbook:', error);
        res.status(500).json({
            error: 'Failed to generate AI operational playbook.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI IAM & Access Simplifier Endpoint
app.post('/api/ai/iam-simplifier', async (req, res) => {
    const { promptContext } = req.body; // user's IAM query/policy

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for IAM simplification is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS IAM Security Architect, analyze the following IAM policy or access scenario described by the user. Your primary goal is to simplify, improve security (enforce least privilege), and adhere to best practices.
                    Provide the following in your response:
                    1.  **Analysis Summary:** Briefly summarize the current intent or potential issues (e.g., overly broad permissions, missing conditions).
                    2.  **Recommendations for Simplification/Least Privilege:** List 2-4 specific, actionable steps or policy changes. If a policy is provided, suggest a simplified JSON policy snippet if applicable, otherwise describe the changes. Focus on reducing privileges to only what's necessary.
                    3.  **Key IAM Best Practice:** Highlight one crucial IAM best practice relevant to the query (e.g., MFA, temporary credentials, tag-based access control).
                    Format your response clearly with bolded headings for each section. Keep the overall response comprehensive but concise.` },
                    { text: `User's Query/Policy: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 500, // Increased tokens for more detailed IAM guidance, including potential JSON snippets
                temperature: 0.4, // Balanced for factual accuracy and helpful suggestions
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ iamGuidance: text });
    } catch (error) {
        console.error('Error generating AI IAM simplification guidance:', error);
        res.status(500).json({
            error: 'Failed to generate AI IAM simplification guidance.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Disaster Recovery (DR) Planner Endpoint
app.post('/api/ai/dr-planner', async (req, res) => {
    const { promptContext } = req.body; // Contains application description, RTO, RPO

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for DR planning is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS Cloud Resilience Architect, design a detailed Disaster Recovery (DR) strategy for the following application based on the user's Recovery Time Objective (RTO) and Recovery Point Objective (RPO).
                    Your response should clearly outline:
                    1.  **Recommended DR Pattern(s):** Suggest 1-2 suitable AWS DR patterns (e.g., Backup & Restore, Pilot Light, Warm Standby, Multi-Region Active/Active) and briefly explain why they fit the given RTO/RPO.
                    2.  **Key AWS Services Involved:** List the primary AWS services required to implement the suggested pattern(s).
                    3.  **Trade-offs & Considerations:** Discuss important implications regarding estimated cost, operational complexity, data consistency, and failover/failback processes.
                    4.  **High-Level Implementation Steps:** Provide a concise, conceptual overview of the steps to implement this strategy.
                    Format your response clearly with bolded headings for each section and use bullet points for lists. Keep the overall response comprehensive but digestible.` },
                    { text: `User's DR Requirements: ${promptContext}` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 500, // Increased tokens for detailed DR planning
                temperature: 0.6, // Balanced for informative and structured architectural advice
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ drPlan: text });
    } catch (error) {
        console.error('Error generating AI DR plan:', error);
        res.status(500).json({
            error: 'Failed to generate AI DR plan.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Explain My Cloud Endpoint
app.post('/api/ai/explain-cloud', async (req, res) => {
    const { promptContext } = req.body; // Cloud configuration (Terraform, CloudFormation, YAML) or architectural description

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for cloud explanation isзирается.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert Cloud Infrastructure Interpreter and Consultant, your task is to explain the following cloud infrastructure configuration or architectural description in natural, easy-to-understand language. Focus on what it does, the main components, and how they interact.
                    If it's code (like Terraform, CloudFormation, YAML), interpret the intent. If it's a description, explain the conceptual setup.
                    Do not include code in your explanation, only natural language.
                    Structure your explanation clearly with paragraphs or bullet points for readability.
                    
                    User's Cloud Configuration/Description:
                    "${promptContext}"` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 500, // Sufficient tokens for a comprehensive explanation
                temperature: 0.5, // Balanced for informative and coherent explanations
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ explanation: text });
    } catch (error) {
        console.error('Error generating AI cloud explanation:', error);
        res.status(500).json({
            error: 'Failed to generate AI cloud explanation.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Teach Me This Setup Endpoint
app.post('/api/ai/teach-me-setup', async (req, res) => {
    const { promptContext } = req.body; // User's learning topic (e.g., "S3", "Lambda", "VPC Peering")

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for learning content is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AI Cloud Tutor, provide a comprehensive and structured explanation for the following AWS cloud service or concept: "${promptContext}".
                    Your explanation should cover the following sections clearly:
                    1.  **What it is:** A concise definition and purpose.
                    2.  **How it works:** A simplified explanation of its core mechanics and typical usage.
                    3.  **Why it might be configured this way:** Common use cases, advantages of specific configurations, and design patterns.
                    4.  **What could go wrong:** Common pitfalls, misconfigurations, or potential issues (e.g., security, performance, cost).
                    
                    Format your response with bolded headings for each section and use bullet points for lists. Aim for clarity and detail suitable for someone learning about the topic. Start directly with the explanation.` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 800, // Increased tokens for comprehensive educational content
                temperature: 0.5, // Balanced for informative and coherent explanations
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ learningContent: text });
    } catch (error) {
        console.error('Error generating AI learning content:', error);
        res.status(500).json({
            error: 'Failed to generate AI learning content.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Service Decision Wizard Endpoint
app.post('/api/ai/service-decision', async (req, res) => {
    const { promptContext } = req.body; // User's comparison query (e.g., "Fargate vs Lambda vs EC2")

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for service decision is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AWS Cloud Service Advisor, analyze the following user query regarding service selection. Provide a balanced comparison (pros and cons) for each option mentioned or implied, and then offer a clear recommendation based on general best practices for modern cloud applications, considering factors like scalability, cost, operational overhead, and flexibility. If the user's input is vague, highlight any assumptions made.
                    
                    User's Query: "${promptContext}"
                    
                    Structure your response clearly with bolded headings for each service being compared, followed by "Pros:" and "Cons:" using bullet points. Conclude with a clear "Recommendation:".` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 600, // Sufficient tokens for detailed comparison and recommendation
                temperature: 0.5, // Balanced for informative and coherent explanations
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ serviceDecision: text });
    } catch (error) {
        console.error('Error generating AI service decision:', error);
        res.status(500).json({
            error: 'Failed to generate AI service decision.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Security Policy Explainer Endpoint
app.post('/api/ai/security-policy-explainer', async (req, res) => {
    const { promptContext } = req.body; // Policy JSON or natural language policy request

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for security policy explanation/generation is required.' });
    }

    let queryType;
    try {
        // Attempt to parse as JSON to determine if it's a policy explanation request
        JSON.parse(promptContext);
        queryType = 'explanation';
    } catch (e) {
        // If not valid JSON, treat it as a policy generation request
        queryType = 'policy_request';
    }

    try {
        const aiPrompt = queryType === 'explanation' ?
            `As an expert AWS Cloud Security Policy Explainer (IAM/SCP), analyze the following JSON policy. Translate it into natural, human-readable language, explaining exactly what permissions it grants or denies. Clearly highlight any dangerous or overly broad permissions (e.g., use of '*' wildcards, 'iam:PassRole', allowing "NotAction", or overly permissive "Resource"). Suggest least-privilege alternatives if obvious.
            
            Policy to explain:
            \`\`\`json
            ${promptContext}
            \`\`\`
            
            Format your response clearly with bolded headings (e.g., **Policy Summary**, **Key Permissions Granted/Denied**, **Potential Risks & Best Practices**, **Recommendations for Least Privilege**). Ensure any JSON policy snippets you provide in recommendations are properly formatted.` :
            `As an expert AWS Cloud Security Policy Generator, the user wants to understand how to write an AWS IAM/SCP policy for the following requirement. Provide a clear, human-readable explanation of what the policy would do, followed by a JSON policy snippet. Also, point out any common security considerations for such a policy (e.g., ensuring least privilege, adding conditions, using specific ARNs).
            
            User's Policy Request: "${promptContext}"
            
            Format your response clearly with bolded headings (e.g., **Policy Intent**, **Recommended Policy JSON**, **Security Considerations**). Ensure the recommended JSON policy snippet is properly formatted.`;

        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [{ text: aiPrompt }]
            }],
            generationConfig: {
                maxOutputTokens: 700, // Sufficient tokens for detailed explanation or generation, including JSON
                temperature: 0.4, // Lower temperature for more factual and direct security advice
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ policyExplanation: text });
    } catch (error) {
        console.error('Error generating AI security policy response:', error);
        res.status(500).json({
            error: 'Failed to generate AI security policy response.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI-Powered Cloud Course Generator Endpoint
app.post('/api/ai/generate-cloud-course', async (req, res) => {
    const { promptContext } = req.body; // User's learning goal

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for course generation is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AI Cloud Curriculum Designer, your task is to generate a step-by-step learning path for the user based on their learning goal. The course should be practical, actionable, and cover the essentials.
                    
                    Learning Goal: "${promptContext}"
                    
                    Your course outline should include:
                    1.  **Course Overview:** A brief introduction to what the user will learn.
                    2.  **Module 1: [Topic Name]**
                        * Key Concepts: (bullet points)
                        * Practice Task (Conceptual): (describe a task that helps solidify understanding, without requiring actual cloud resources, e.g., "Design a simple VPC architecture..." or "Outline the steps to configure S3 permissions...").
                        * Quiz Question: (1-2 multiple choice or short answer questions related to the module).
                    3.  **Module 2: [Topic Name]**
                        * Key Concepts: (bullet points)
                        * Practice Task (Conceptual): (describe another task)
                        * Quiz Question: (1-2 questions)
                    4.  **Module 3: [Topic Name]**
                        * Key Concepts: (bullet points)
                        * Practice Task (Conceptual): (describe another task)
                        * Quiz Question: (1-2 questions)
                    5.  **(Optional) Module 4/5...** (if the topic warrants more depth)
                    6.  **Conclusion & Next Steps:** Summarize and suggest how to continue learning or apply knowledge.
                    
                    Use clear, bolded headings for modules and sections. Ensure practice tasks are conceptual/design-focused, as actual lab environments are not simulated here. Keep the quizzes simple, short, and conceptual.` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 800, // Sufficient tokens for a comprehensive course outline
                temperature: 0.6, // Balanced for informative, creative, and structured curriculum design
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ courseContent: text });
    } catch (error) {
        console.error('Error generating AI cloud course:', error);
        res.status(500).json({
            error: 'Failed to generate AI cloud course.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Interactive Cloud Labs Endpoint
app.post('/api/ai/interactive-cloud-lab', async (req, res) => {
    const { promptContext } = req.body; // User's lab task request

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for interactive cloud lab is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AI Cloud Lab Simulator and Virtual Instructor, your task is to guide the user through a simulated interactive lab experience based on their described task.
                    Provide step-by-step instructions. These instructions should simulate actual AWS CLI commands or AWS Management Console steps.
                    Focus on a single, clear task. If the user's request is too broad, ask them to narrow it down.
                    
                    User's Lab Task Request: "${promptContext}"
                    
                    Structure your response as a "Lab Guide" with:
                    **Lab Title:** [Your generated title]
                    **Goal:** [Briefly restate the goal]
                    **Scenario:** [A simple, motivating context for the lab]
                    **Instructions:**
                    1.  **Step 1: [Action Description]**
                        \`\`\`bash
                        # Simulated AWS CLI Command or concise console steps
                        aws service action --parameter value --another-parameter another-value
                        \`\`\`
                        *Expected Output/Outcome:* (brief description of what they should see/expect)
                    2.  **Step 2: [Action Description]**
                        \`\`\`bash
                        # Simulated AWS CLI Command or concise console steps
                        aws service another-action --param value
                        \`\`\`
                        *Expected Output/Outcome:* (brief description)
                    3.  **Step 3: [Action Description]**
                        ... (repeat for 3-5 logical steps, keeping instructions clear and distinct)
                    **Verification:** (How can the user conceptually verify their work? E.g., "Check the S3 console...", "Use 'aws ec2 describe-instances'...")
                    **AI Feedback/Tips:** (Optional, provide a tip or highlight a common pitfall/best practice for this lab task, keeping it concise.)
                    
                    Ensure the commands are realistic for AWS CLI, even if simulated. Use placeholder values for sensitive information (e.g., "my-unique-bucket-name", "your-key-pair", "instance-id-from-previous-step"). Do not use real account numbers. Use clear formatting including code blocks for CLI commands. If the task is purely theoretical, adjust the instructions to be conceptual steps rather than CLI commands.` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 700, // Sufficient tokens for detailed lab instructions, including CLI commands
                temperature: 0.6, // Balanced for informative, creative, and structured guidance
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ labContent: text });
    } catch (error) {
        console.error('Error generating AI interactive cloud lab:', error);
        res.status(500).json({
            error: 'Failed to generate AI interactive cloud lab.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Flashcards & Quizzes Endpoint
app.post('/api/ai/flashcards-quizzes', async (req, res) => {
    const { promptContext } = req.body; // User's topic for flashcards/quizzes

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for flashcards and quizzes is required.' });
    }

    try {
        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert Cloud Educator, your task is to generate a set of flashcards and a short quiz (3-5 multiple-choice questions) for the following AWS cloud topic.
                    
                    Topic: "${promptContext}"
                    
                    Structure your response clearly with bolded headings for each section.
                    
                    **Flashcards:**
                    - **Term/Concept 1:** Definition
                    - **Term/Concept 2:** Definition
                    ... (provide 5-7 relevant flashcards, concise and clear)
                    
                    **Quiz:**
                    1.  **Question 1:** [Question Text]
                        a) Option A
                        b) Option B
                        c) Option C
                        d) Option D
                        *Correct Answer:* [Correct Option Letter, e.g., (a)]
                    2.  **Question 2:** [Question Text]
                        a) Option A
                        b) Option B
                        c) Option C
                        d) Option D
                        *Correct Answer:* [Correct Option Letter, e.g., (b)]
                    ... (provide 3-5 multiple-choice questions, ensure each has a clear correct answer)
                    
                    Ensure flashcards are concise and definitions are accurate. Quizzes should test fundamental understanding of the topic.` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 700, // Sufficient tokens for multiple flashcards and quiz questions
                temperature: 0.6, // Balanced for informative and varied questions/definitions
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        res.json({ learningContent: text });
    } catch (error) {
        console.error('Error generating AI flashcards/quizzes:', error);
        res.status(500).json({
            error: 'Failed to generate AI flashcards or quizzes.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});

// NEW: AI Cloud Career Guide Endpoint
// This endpoint receives user's career goals/background and provides
// suggestions for roles, skills, certifications, and a roadmap.
app.post('/api/ai/cloud-career-guide', async (req, res) => {
    const { promptContext } = req.body; // User's career query

    if (!promptContext) {
        return res.status(400).json({ error: 'Prompt context for cloud career guide is required.' });
    }

    try {
        console.log('Received request for /api/ai/cloud-career-guide'); // Diagnostic log
        console.log('Sending prompt to Gemini for career guide:', promptContext.substring(0, 200) + '...'); // Diagnostic log

        const chatCompletion = await textOnlyModel.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: `As an expert AI Cloud Career Advisor, provide comprehensive guidance for the user's cloud career goals. Based on their input, suggest relevant cloud roles, essential skills, recommended certifications, and a general roadmap to achieve their aspirations.
                    
                    User's Background/Goal: "${promptContext}"
                    
                    Structure your response clearly with bolded headings for each section:
                    1.  **Suggested Cloud Roles:** (list 1-3 roles with brief descriptions, e.g., Cloud Engineer, DevOps Engineer, Cloud Security Specialist)
                    2.  **Key Skills Required:** (list 5-7 technical skills like programming languages, IaC tools, specific AWS/Azure/GCP services, and important soft skills like problem-solving, communication)
                    3.  **Recommended Certifications:** (list 1-3 relevant and widely recognized cloud certifications, e.g., AWS Certified Solutions Architect - Associate, Azure Developer Associate, Google Cloud Professional Cloud Architect)
                    4.  **Learning Roadmap:** (provide a clear, step-by-step general guide, e.g., "Phase 1: Cloud Fundamentals (identify key services, networking basics)", "Phase 2: Hands-on Experience (build projects, contribute to open source)", "Phase 3: Specialization & Certification (choose a path, prepare for exams)", "Phase 4: Continuous Learning & Networking")
                    
                    Ensure the advice is practical, actionable, and realistic for typical career progression in the cloud industry. If the input is too vague, politely ask for more details on current experience, desired specialization, or specific interests to provide a more tailored guide.` }
                ]
            }],
            generationConfig: {
                maxOutputTokens: 800, // Sufficient tokens for detailed career guidance
                temperature: 0.7, // Slightly higher temperature for more comprehensive and varied suggestions
            },
        });
        const response = chatCompletion.response;
        const text = response.text();
        console.log('Gemini career guide content received:', text.substring(0, 100) + '...'); // Diagnostic log
        res.json({ careerGuideContent: text }); // Send the AI's generated content back
    } catch (error) {
        console.error('Error generating AI cloud career guide:', error);
        res.status(500).json({
            error: 'Failed to generate AI cloud career guide.',
            details: error.message || 'An unknown error occurred.',
            geminiErrorDetail: error.response ? JSON.stringify(error.response.candidates, null, 2) : 'No specific Gemini error response.'
        });
    }
});


// Start the server
app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
