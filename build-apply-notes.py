#!/usr/bin/env python3
"""Write output/<job>/apply.md — the copy-paste sheet for one application.

Covers the three questions data/answers.yml leaves per-job (salary, why this
company, why a good fit). Salary is anchored to that posting's OWN advertised
range: the universal "SGD 6,000-9,000" answer would under-quote the roles that
advertise above it. Everything else comes from data/answers.yml unchanged.
"""
import json, os, re, yaml, glob

UNIVERSAL = """| Question | Answer |
|---|---|
| Notice period | 2 months |
| Right to work | Based in Malaysia; would require a Singapore Employment Pass. No SG PR or EP currently held. |
| Years of experience | 5 years across the full software development lifecycle. |
| Current location | Kuala Lumpur, Malaysia. |
| Willing to relocate | Yes. Actively seeking roles in Singapore and prepared to relocate. |
| Current employer | Full Stack Software Engineer at Itechoice Sdn Bhd, Kuala Lumpur, since November 2025. |
| Highest qualification | BSc Computer Science, University Malaysia of Computer Science & Engineering (2021), GPA 3.79/4.00. |
| Address | 13-03A, Aster Residence, Jalan Cheras Hartamas, 56100 Cheras, Wilayah Persekutuan Kuala Lumpur, Malaysia |
| Postal code | 56100 |"""

J = {
 "041-antas": dict(
   salary="SGD 8,000 to 8,500 per month, negotiable on the overall package.",
   why=("Antas builds and maintains enterprise web applications and APIs on the Microsoft stack, which is "
        "where my five years have been spent. The posting is unusually specific about troubleshooting "
        "production incidents and performance issues, and that is the part of the job I am best at rather "
        "than an afterthought."),
   fit=("Direct stack overlap: C#, .NET Core, ASP.NET Core Web API, TypeScript front end, microservices and "
        "SQL design and tuning, all across five years and three employers. I have shipped React in "
        "production on client projects, which covers the React.js line. Where I add most is after release: "
        "I root-cause production failures from source code, logs and SQL queries, work that cut one "
        "application's crash rate by 97% and produced up to 30% performance gains elsewhere.")),
 "030-neptunez": dict(
   salary="SGD 8,000 to 9,000 per month, negotiable on the overall package.",
   why=("The role is a straight full-stack .NET seat with a modern JavaScript front end and real SQL "
        "ownership, which is exactly the shape of work I have done for five years rather than a stretch "
        "into an adjacent stack."),
   fit=("C# and .NET Core backends with TypeScript front ends across three employers, RESTful services "
        "inside microservices architectures, and SQL I design and tune myself for up to 30% gains. Your "
        "posting accepts Angular or React and React is the one I have shipped in production. I own "
        "problems after release, root-causing incidents from source, logs and SQL.")),
 "034-tiktok": dict(
   salary="SGD 12,000 to 15,000 per month, negotiable on the overall package.",
   why=("Two things in the posting: Java as the backend language and AI-native engineering practices. I am "
        "building an AI capability hub on Java Spring Boot right now, orchestrating skills, knowledge, "
        "agents, memory and workflows against a hosted model. That is the work, not an aspiration toward it."),
   fit=("Java Spring Boot is my current production stack, deployed on AWS. Behind it sits five years of "
        "backend delivery with a consistent record of measurable performance engineering: up to 30% gains "
        "from full-stack and SQL optimisation, a 97% crash-rate reduction from memory rework, and bottleneck "
        "resolution across front-end, back-end and database layers. I would be clear that I have not worked "
        "with Spark, Flink, Kafka, ClickHouse or Doris.")),
 "043-elliott-moss": dict(
   salary="SGD 7,500 to 8,500 per month, negotiable on the overall package.",
   why=("The .NET half of the role matches five years of my work, and the posting's emphasis on "
        "troubleshooting production incidents and secure coding lines up with what I am strongest at. I "
        "would want to know which bank the role sits with before going further."),
   fit=("Five years of C# and .NET Core with TypeScript front ends inside microservices. I review code for "
        "security and compliance, identifying vulnerabilities and shipping fixes, which should matter for a "
        "banking client. Production incident ownership is my strongest card. I have not shipped Angular, and "
        "I would rather say so now than after a screen.")),
 "048-quess": dict(
   salary="SGD 7,500 to 8,000 per month, negotiable on the overall package.",
   why=("The .NET and SQL core of the role maps directly to five years of my delivery work, and the "
        "production-support responsibilities are the part I do best."),
   fit=("Hands-on C# and .NET Core with RESTful APIs and SQL optimisation producing up to 30% gains, plus "
        "security-conscious code review. My gaps are real and worth stating: no Angular, no banking-sector "
        "background, and no named CI/CD or unit-test tooling.")),
 "052-trust-recruit": dict(
   salary="SGD 7,000 to 9,000 per month. For an on-site Singapore role I need the package to clear SGD 6,000, which is the Employment Pass qualifying salary.",
   why=("The essential stack in the posting reads almost exactly as my last five years: C#, .NET Core, Web "
        "API, microservices and Docker, with AWS as a plus and AWS being where I deploy. I would want to "
        "know who the end client is before going further."),
   fit=("Backend services on C# and .NET Core across three companies inside microservices, RESTful Web APIs "
        "with JSON and XML, Docker in hands-on use, and AWS S3 and Lambda deployment with build automation I "
        "wrote. Measurable performance work: up to 30% gains in critical .NET components. I have not used "
        "Entity Framework, and my SQL is engine-general rather than MySQL specifically.")),
 "042-antas-senior": dict(
   salary="SGD 9,500 to 11,000 per month, in line with the advertised range.",
   why=("Same reasons as the mid-level Antas opening, which I am also applying for. I would rather be "
        "considered for whichever of the two you judge the better fit than have both applications look like "
        "a scattergun."),
   fit=("Five years of C# and .NET Core, a Senior title held 2023 to 2025, and mentoring of three to four "
        "junior engineers, which matches the mentoring responsibility. Analysing complex technical issues is "
        "my core strength. Against the senior bar I am short in four specific places: total years, "
        "commercial React or Angular, Azure, and the ASP.NET Core Identity and OAuth stack.")),
 "049-jondavidson": dict(
   salary="SGD 7,000 to 9,000 per month, negotiable on the overall package.",
   why=("The essential .NET and TypeScript stack matches my background directly, and the troubleshooting and "
        "system-outage responsibilities describe the work I am best at. I would want the end client named."),
   fit=("Five years of C# and .NET Core with TypeScript inside microservices. Production support is my "
        "strongest card: incident investigation through source review, logs and SQL, and standing as "
        "technical escalation point. Up to 30% performance gains from optimisation work. I have not shipped "
        "Angular and have no banking-domain background.")),
 "040-techemerge": dict(
   salary="SGD 8,000 to 10,000 per month, negotiable on the overall package.",
   why=("The core of the role, .NET backends with React and TypeScript on AWS, is my actual background. I "
        "would be upfront that the eight-year bar is above where I am."),
   fit=("Five years across three companies, Senior title 2023 to 2025, mentoring three to four juniors. "
        "React is real production work: plushinteriordesign.sg is a live multi-page React application on "
        "Vite with a React admin CMS. AWS S3 and Lambda plus Docker. Up to 30% performance gains and a 97% "
        "crash-rate reduction. Not in my record: Next.js, Jest, Storybook, DDD, OAuth, event-driven "
        "architecture, API Gateway and DynamoDB.")),
 "031-alpha-x": dict(
   salary="SGD 6,000 to 6,500 per month. SGD 6,000 is a hard floor for me because it is the Employment Pass qualifying salary for an on-site Singapore role.",
   why=("Java Spring Boot is my current backend stack and the posting's performance-tuning requirement is "
        "close to a description of my day-to-day."),
   fit=("Building a production Java Spring Boot platform on AWS right now. SQL has been constant across five "
        "years: schema design, query writing and retrieval tuning producing up to 30% gains. I root-cause "
        "production issues from source, logs and SQL. My hands-on Java is about nine months, in the current "
        "role, and my longer backend history is C# and .NET Core.")),
 "035-acp": dict(
   salary="SGD 6,800 to 7,500 per month, in line with the advertised range.",
   why=("Spring Boot on AWS is what I am building now, and the posting's emphasis on full-lifecycle delivery "
        "with day-to-day application support matches five years of my work. I would want to confirm which "
        "vendor holds the requisition, since I saw the same posting under other company names."),
   fit=("Live Java Spring Boot and AWS work, not a stale stack. Five years of full-lifecycle delivery from "
        "requirements through post-release support, inside microservices. Application support is my "
        "strongest area. Gaps: about nine months hands-on Java, no ECS or Fargate, no Java unit-test "
        "framework, DAO patterns or UML professionally. Docker I do use.")),
 "038-recruit-express": dict(
   salary="SGD 7,500 to 8,500 per month, in line with the advertised range.",
   why=("The 360-degree troubleshooting responsibility is the strongest thing I do. I should say plainly that "
        "several mandatory items are outside my record, and I would still be interested in a senior "
        "individual-contributor seat on the same team if one exists."),
   fit=("Five years of C# and .NET Core, a Senior title 2023 to 2025, and mentoring of three to four juniors. "
        "End-to-end troubleshooting across source, logs and SQL, cutting one application's crash rate by 97%. "
        "Against the posting: no .NET Framework 4.8 specifically, no SQL Server by name, no Azure, and no "
        "formal team-management track record, so Lead is a genuine step up.")),
 "045-altrocks-golang": dict(
   salary="SGD 6,000 to 6,500 per month. SGD 6,000 is a hard floor because it is the Employment Pass qualifying salary.",
   why=("The posting asks for strong experience in at least one of Golang, Python, Node.js or .NET, and I "
        "bring two of them with production delivery behind each."),
   fit=(".NET Core and Node.js both in production: Node.js REST APIs at TESS on AWS with build automation I "
        "wrote, and C# and .NET Core at Itechoice and Hokenso. Microservices across all three. Vue.js and "
        "React on the front end, both on your accepted list. Docker hands-on. I have not written Golang, and "
        "I read the requirement as one of the four rather than Golang specifically.")),
 "047-altrocks-dotnet": dict(
   salary="I would need the package to reach at least SGD 6,000 per month, since that is the Employment Pass qualifying salary for an on-site Singapore role. The advertised range tops out there, so this is worth settling early.",
   why=("C#, ASP.NET Core MVC and object-oriented fundamentals are evidenced across all three of my "
        "employers, and the good-to-have lines on databases and front end are both covered by real work."),
   fit=("Five years of C# and .NET Core delivery, RESTful API design and integration, and SQL schema and "
        "query work producing up to 30% gains. React shipped on production client projects. Gaps: no VB, "
        "five years and three months against your six-year ask, and no formal unit testing or SIT and UAT "
        "coordination as named responsibilities.")),
}

for d, v in J.items():
    p = f"output/{d}"
    if not os.path.isdir(p):
        print(f"MISSING {p}")
        continue
    rf = [f for f in glob.glob(f"reports/{d[:3]}-*.md") if "RESERVED" not in f]
    url = ""
    if rf:
        m = re.search(r"\*\*URL:\*\*\s*(\S+)", open(rf[0]).read())
        url = m.group(1) if m else ""
    md = f"""# Apply: {d}

**Posting:** {url}

**Attach:** `cv.pdf` and `cover.pdf` from this folder.

> foundit hands off to the employer or needs an account login, so you submit this
> yourself. Nothing here has been sent.

## Per-job answers

**Expected monthly salary**

> {v['salary']}

**Why do you want to join / why are you interested?**

> {v['why']}

**Why are you a good fit for this role?**

> {v['fit']}

## Universal answers (from data/answers.yml)

{UNIVERSAL}

## After you submit

Tell me, and I will run:

```
node set-status.mjs {d[:3]} Applied --note "Applied {{date}} via foundit"
```

which also seeds the follow-up date.
"""
    open(f"{p}/apply.md", "w").write(md)
    print(f"wrote {p}/apply.md")
