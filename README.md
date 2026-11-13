# Alphonse
> Developer: [Brandon Bayquen](https://github.com/bayquen)

### Slack assistant that helps onboard your engineers faster.

<p align="center">
   <img width="358" height="358" alt="alphonse-serious-mogging" src="https://github.com/user-attachments/assets/b61b2f96-b7f6-4b29-8b0e-f1b3f1fe20b2" />
</p>

## Main Commands
- **Ask Alphonse (Q&A)**: On a Slack channel where the assistant resides, type `@Alphonse <prompt>` and send.  
- `/add_repo <https://github.com/[user]/[repo-name]>` - Queues and adds your team's GitHub repo to Alphonse's memory (max 1 repo per Slack workspace)  
- `/add_linear_workspace` - Queues and adds your team's Linear workspace Issues to Alphonse's memory (make sure to choose ONLY your team's workspace via your Linear account)  
  
### *Hi there. You're may be wondering what Alphonse is...*

## Introduction
<p align="center">
<img width="500" height="210" alt="alphonse-goofy-mogging" src="https://github.com/user-attachments/assets/2065ad62-3f38-41cd-98f4-119c8fd8f0cf" />
</p>
  
***Alphonse*** is a Q&A Slack assistant that quickly answers technical questions about your team's software product. 
Get up to speed on product features, system architecture, updates, and team product decisions. 
He can read data from both your team's GitHub repo and relevant Linear workspace for comprehensive Q&A queries (technical + business/product-level context).

> And yes, my assistant is inspired by Al Elric from Fullmetal, hence his character :)  

## Setup and Usage
### **REQUIREMENTS:** 
- a Slack account  
- a Slack workspace that you have admin or app installation permissions.  
> ⚠️Important note for Slack developers: make sure you're on a regular Slack workspace and NOT on Developer Sandbox!)  
- ***(highly recommended, but optional):*** a Linear account + workspace associated with your team's product.  
> Linear-team data access gives Alphonse business decision context for Q&A.  
  
### **SETUP INSTRUCTIONS:**  
1. **INSTALL.** Follow this [awesome URL](https://rtfm-web.onrender.com/slack/install) to install Alphonse.  
2. Click the "**Add to Slack**" button. Then on the new Slack auth page, choose your team's Slack workspace in which Alphonse will be installed. (You should be redirected to a "Yippee!" page upon success.)  
3. Open your team's Slack workspace and open a channel where you'd like to ask questions.  
4. Then run this Slack command: `/invite @Alphonse`. You can also click the channel name, open **Integrations**, and add Alphonse from there. Of course, you can have him present in multiple Slack channels.  
### Teach Alphonse about your product's GitHub repo
5. **ADD YOUR REPO.** In any Slack channel where your team invited Alphonse, run the `/add_repo` command followed by your team's repo URL, ***including*** the `https://` prefix! Alphonse will check that he can reach the repository (and that it's a valid URL).  
> **Please follow this URL format:** `/add_repo https://github.com/user/your-repo`
  
- If your repo is set to **public**: he'll confirm that it's been queued to be stored in his memory.  
- Otherwise, if it's **private**: a pop-up will appear:
  
   a. For private repos, click the access link provided 
  
   b. Approve access for Alphonse on the GitHub page that opens. Select the desired repo you want Alphonse to read from. Just make sure you have access to that private repo.  
     
   c. Once you see "GitHub app authorized" in a new page, you may close it and return to Slack, running `/add_repo <GitHub URL>` again!  
     
6. Wait for Alphonse to finish reading (wait time depends on repo size). A confirmation DM from Alphonse will be sent to you upon success.  
> Note: If you see a "Repo Access Failed" pop-up on Slack, make sure the **GitHub URL** is correct and try again  
  
### Connect your Linear workspace
> (**Recommended** for comprehensive Q&A, but optional)  
7. **ADD YOUR LINEAR TEAM.** Run the Slack command: `/add_linear_workspace`  
8. Click the access link provided in the Connect Linear pop-up and follow the steps in the Linear redirect page.
- ⚠️ **IMPORTANT:** Alphonse v1.0 has a bug where he forgets to delete previously-ingested Linear team data when you completely run `/add_linear_workspace` a 2nd time. So make sure you initially pick the correct ***Linear*** team/workspace associated with your ***GitHub*** repo.
9. Approve access for your desired Linear workspace/team. When you see "Linear connected!", return to Slack. Alphonse can now read your team's Linear issues.
> Now you can ask Alphonse anything regarding your product's code AND your team's product decisions! Just @Alphonse <prompt>  
  
## Usage Tips
### Example questions to ask Alphonse:  
| **Question** | **Description** |
|---|---|
"Help me get familiar with our product quickly as a new engineer." | e.g. Alphonse answers by retrieving from your team's repo docs |
"How does [feature X] work? Explain the flow step by step." | e.g. retrieves answer via repo + Linear |
"Which blockers do you recommend we prioritize now?" | e.g. retrieves answer via your team's Linear Issues |
"Why did we decide to implement [feature X]?" | e.g. both from repo and Linear |

### Tips to maximize Alphonse's usefulness

1) ⚠️**MOST IMPORTANT:** Keep your product's documentation up to date!! Alphonse works best when your repo docs and Linear issues are comprehensive and well-written. Alphonse provides better answers the more thorough and clear all your documentation is.

2) If Alphonse says he doesn't know, the information probably isn't in your connected repos or Linear workspace. He won't make up an answer.  

3) Just like with any other LLM interface, be as specific as needed. "How does enterprise login work in the OAuth service?" is more specific than "How does our login work?"  

## Tech Stack (v1)
| **Layer** | **Technology** |  
|---|---|  
Frontend | *N/A* (Slack's UI) |   
Backend | Node.js · TypeScript · Express · Slack Bolt JS  
Databases | Supabase (PostgreSQL + pgvector) | Redis Cloud |  
Auth | GitHub OAuth | Linear OAuth | Slack OAuth |  
AI | OpenAI - `gpt-6.1-sol` |  
Embeddings (RAG) | Voyage AI - `voyage-code-3` |  
Frontend deploy | Slack |  
Backend deploy | Render (WebSocket required) |  
  
## FAQ
### What is Linear and why does Alphonse connect to it?
- Linear is a trusted platform used by software and product teams alike to help organize and keep track of their software-related projects. You use it to manage project tasks, bugs, and features, assign responsibilities, and stay on top of development progress.
- Alphonse uses Linear data to get better context of your team's product decisions and tasks that your GitHub repo(s) may otherwise not have documentation for. Assuming your team's Linear is well-documented, you'll have better decisional context at the business/org level, rather than just technical context.

### Where can I provide feedback or suggestions on Alphonse?
- Any feedback (bug reports, improvements, feature suggestions) are happily appreciated in the [Discussions](https://github.com/bayquen/alphonse/discussions) page.  
- OR, feel free to connect with me via [LinkedIn](https://linkedin.com/in/bayquen) with a connection note, so I know you used Alphonse! I'm quite active and post my work there mainly :)  
