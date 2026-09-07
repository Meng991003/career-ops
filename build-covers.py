#!/usr/bin/env python3
"""Write one cover-letter payload per job into tailor/covers/.

Rebuilt 2026-08-31 against reports 055-077, produced AFTER the JD-extraction fix
that added experienceRequirements / qualifications / skills. The earlier round
was written from partial JDs and scored several roles too high; every `problems`
string here names the gaps that job's CORRECTED report found.

Only roles scoring >= 3.0 are built. Run: python3 build-covers.py
"""
import json, os, re

# Contact details are read from cv.md, never hardcoded here. cv.md is the
# canonical source under the AGENTS.md Data Contract and is gitignored, which
# keeps this script free of personal data so it can be tracked -- `origin` is a
# fork of a public upstream, and a fork of a public repo cannot be made private.
# Presentation is unchanged: cv.md's contact line is already the display form.
CV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cv.md")


def load_candidate(path=CV_PATH):
    """Name from the H1; the rest from cv.md's ` · `-separated contact line."""
    with open(path, encoding="utf-8") as fh:
        lines = [line.strip() for line in fh.read().splitlines()]

    name = next((l.lstrip("#").strip() for l in lines if l.startswith("# ")), "")
    contact = next((l for l in lines if "@" in l and "·" in l), "")
    if not name or not contact:
        raise SystemExit(
            f"build-covers: no name/contact line found in {path}. Refusing to emit "
            "cover letters with blank contact details."
        )

    out = {"name": name.title(), "location": "", "email": "", "phone": "", "linkedin": ""}
    for part in (p.strip() for p in contact.split("·")):
        if "@" in part:
            out["email"] = part
        elif "linkedin.com" in part:
            out["linkedin"] = part
        elif re.fullmatch(r"\+?[\d\s()\-]+", part) and re.search(r"\d{3}", part):
            out["phone"] = part
        elif part:
            out["location"] = part

    missing = sorted(k for k, v in out.items() if not v)
    if missing:
        raise SystemExit(
            f"build-covers: {path} contact line did not yield {missing}. "
            "Fix cv.md rather than hardcoding values here."
        )
    return out


CAND = load_candidate()
DATE = "31 August 2026"

A_DOTNET = {"lead": "C# and .NET Core across three enterprise employers",
            "impact": "working inside microservices architectures and building RESTful services with JSON and XML integration."}
A_SQL = {"lead": "SQL design, query writing and retrieval performance tuning",
         "impact": "including the query optimisation behind the 30% gains above."}
A_RCA = {"lead": "Production incident ownership",
         "impact": "root-causing failures from source code, application logs and database queries, and acting as technical escalation point for customer-reported issues."}
A_REACT = {"lead": "React and TypeScript in production",
           "impact": "I built and shipped plushinteriordesign.sg, a multi-page React application on Vite, plus its React admin CMS, and the React front end for a court booking system."}
A_REVIEW = {"lead": "Code review and mentoring",
            "impact": "reviewing for security and compliance, and mentoring three to four junior engineers."}
A_JAVA = {"lead": "Java and Spring Boot in production today",
          "impact": "I am currently building an AI capability hub on Spring Boot, deployed on AWS, that orchestrates skills, knowledge, agents, memory and workflows against a hosted model."}
A_DOCKER = {"lead": "Docker, microservices and AWS",
            "impact": "containers in hands-on use, microservices across all three employers, and S3 and Lambda deployment with build automation scripting at TESS."}
A_SECURE = {"lead": "Secure code review",
            "impact": "regular reviews for security and compliance at Itechoice, identifying vulnerabilities and implementing corrective fixes."}

CLOSE = ("On practicalities: I am based in Kuala Lumpur and relocating to Singapore, so the role "
         "would require a work pass. My notice period is two months. ")

# Shared paragraphs for the three near-identical Angular-and-.NET banking placements.
BANK_INTRO = ("Across three companies I have delivered and supported enterprise web applications on C# and "
              ".NET Core with TypeScript front ends, inside microservices architectures. I review code for "
              "security and compliance, identifying vulnerabilities and shipping the fixes, which I expect "
              "matters for a banking end client. When something breaks in production I find it from source "
              "code, logs and SQL: at Hokenso that took one application's crash rate down by 97%, and at "
              "Itechoice query and full-stack optimisation produced up to 30% gains in critical components.")

JOBS = [
 dict(num="057", slug="neptunez", spec="tailor/antas.yml",
   role="Full Stack .NET Developer", company="Neptunez Singapore Pte. Ltd.",
   salary="SGD 8,000 to 9,000 per month, negotiable on the overall package.",
   opening=("I am applying for the Full Stack .NET Developer role. Your posting describes the stack I have "
            "worked in for five years: C# and .NET Core behind a TypeScript front end, REST APIs across "
            "microservices, and SQL that has to stay fast under real load."),
   intro=("I have spent five years across three companies delivering enterprise web applications end to end, "
          "from requirements through deployment and post-release support. The line in your posting about "
          "troubleshooting and root cause analysis is where I am strongest: I diagnose production failures "
          "from source code, application logs and database queries rather than guessing. At Hokenso that "
          "meant cutting one application's crash rate by 97% and bringing critical defects down from three "
          "to five per quarter to two or three. At Itechoice, full-stack and SQL query optimisation produced "
          "gains of up to 30% in critical components."),
   ach=[A_DOTNET, A_SQL, A_REACT, A_RCA],
   problems=("Two things I should be straight about. Your posting asks for six or more years and I have five "
             "years and three months, so I am slightly under. You also name Entity Framework, and I have no "
             "ORM experience to point to. On the front end you accept Angular or React: React is the one I "
             "have, through production client work. My SQL experience is engine-general rather than SQL "
             "Server by name, though the design and tuning skill underneath transfers directly."),
   ask="I would welcome the chance to talk the role through.",
   why=("The role is a straight full-stack .NET seat with a modern JavaScript front end and real SQL "
        "ownership, which is the shape of work I have done for five years rather than a stretch into an "
        "adjacent stack."),
   fit=("C# and .NET Core backends with TypeScript front ends across three employers, RESTful services "
        "inside microservices, and SQL I design and tune myself for up to 30% gains. You accept Angular or "
        "React and React is the one I have shipped in production. I own problems after release.")),

 dict(num="069", slug="elliott-moss", spec="tailor/dotnet-angular-banking.yml",
   role="Software Developer (Angular & .NET)", company="Elliott Moss Consulting Pte. Ltd.",
   salary="SGD 7,500 to 8,500 per month, negotiable on the overall package.",
   opening=("I am applying for the Software Developer (Angular & .NET) role. The .NET half of that title is "
            "where I have spent five years, and your posting's lines on troubleshooting production incidents "
            "and secure coding are the parts of the job I am strongest at."),
   intro=BANK_INTRO,
   ach=[A_DOTNET, A_RCA, A_SECURE, A_SQL],
   problems=("I should be direct about the front end. I have no Angular experience. My SPA work is Vue.js in "
             "paid roles and React on production client projects. Those are a different component-framework "
             "family, so while the concepts carry over I am not going to claim a framework I have not "
             "shipped. If Angular is a hard day-one requirement rather than something you would let me pick "
             "up, please tell me and I will not take up more of your time."),
   ask=("I would also like to understand which bank the role sits with, and whether this is agency payroll "
        "or a direct client hire, since the posting states neither."),
   why=("The .NET core of the role matches five years of my work, and the posting's emphasis on "
        "troubleshooting production incidents and secure coding lines up with what I am strongest at."),
   fit=("Five years of C# and .NET Core with TypeScript front ends inside microservices, plus security and "
        "compliance code review. Production incident ownership is my strongest card. I have not shipped "
        "Angular, and I would rather say so now than after a screen.")),

 dict(num="077", slug="trust-recruit", spec="tailor/dotnet-backend-docker.yml",
   role="Backend Developer (.NET Core / Web API / Microservices / Docker)", company="Trust Recruit Pte. Ltd.",
   salary=("SGD 7,000 to 9,000 per month. For an on-site Singapore role I need the package to clear "
           "SGD 6,000, which is the Employment Pass qualifying salary."),
   opening=("I am applying for the Backend Developer role. Your essential stack reads almost exactly as my "
            "last five years: C#, .NET Core, Web API, microservices and Docker, with AWS listed as a plus "
            "and AWS being where I deploy."),
   intro=("I have built and supported backend services on C# and .NET Core across three companies, inside "
          "microservices architectures, with RESTful Web APIs handling JSON and XML integration. Docker is "
          "in hands-on use. At TESS I deployed on AWS S3 and Lambda and wrote the build and deployment "
          "automation. Performance is where I have measurable results: up to 30% gains in critical .NET "
          "components through full-stack and SQL query optimisation, and a 97% crash-rate reduction from "
          "reworking memory usage."),
   ach=[A_DOTNET, A_DOCKER, A_SQL, A_RCA],
   problems=("Three honest notes. I have not used Entity Framework, which your posting names specifically. "
             "My NoSQL exposure is limited to early-career Elasticsearch work that I would not call a "
             "working strength. And while I apply object-oriented practice daily across C# and Java, I have "
             "not written up formal design-pattern vocabulary, so expect me to describe the practice rather "
             "than recite the catalogue. I would also flag that the advertised range starts at SGD 5,800, "
             "and for an on-site Singapore role I need to clear SGD 6,000 for Employment Pass eligibility."),
   ask="Since the end employer is not named in the posting, I would like to know who the client is and what the team looks like.",
   why=("The essential stack in the posting reads almost exactly as my last five years, and AWS is listed as "
        "a plus and is where I already deploy. I would want to know who the end client is before going further."),
   fit=("Backend services on C# and .NET Core inside microservices, RESTful Web APIs with JSON and XML, "
        "Docker hands-on, and AWS S3 and Lambda deployment with build automation I wrote. Up to 30% gains "
        "in critical .NET components. Not Entity Framework, and limited NoSQL.")),

 dict(num="067", slug="antas", spec="tailor/antas.yml",
   role="Full Stack Developer (.NET)", company="Antas Pte. Ltd.",
   salary="SGD 8,000 to 8,500 per month, negotiable on the overall package.",
   opening=("I am applying for the Full Stack Developer (.NET) role, and I want to address the experience "
            "bar in the first line rather than bury it. Your posting's metadata states eight years required. "
            "I have five years and three months. If that is a firm screen, I would rather you know now."),
   intro=("What I would bring against it: five years of C# and .NET Core delivery across three employers, "
          "with ASP.NET Core Web API, TypeScript front ends, microservices, and SQL design and tuning. I "
          "also held a Senior title from 2023 to 2025 and mentored three to four junior engineers, so the "
          "ownership is ahead of the raw tenure. Your posting is unusually specific about troubleshooting "
          "production incidents and performance issues, and that is the part of the job I am best at: I "
          "root-cause failures from source code, logs and SQL queries. That work cut one application's crash "
          "rate by 97%, and query and full-stack optimisation produced up to 30% gains in critical components."),
   ach=[A_DOTNET, A_SQL, A_REACT, A_RCA],
   problems=("Beyond the three-year experience shortfall, four named items are not in my record: Entity "
             "Framework Core and LINQ, the JWT / OAuth 2.0 / OpenID Connect and ASP.NET Core Identity "
             "authentication stack, and unit testing with xUnit, NUnit or MSTest. My front-end work is React "
             "rather than Angular. I am not going to claim any of them. If the eight-year bar and those "
             "specifics are all firm, this is not a fit and I would rather establish that in one email than "
             "after a screening call."),
   ask="I would welcome your read on whether the eight-year figure is a hard filter or a guide.",
   why=("Antas builds and maintains enterprise web applications and APIs on the Microsoft stack, which is "
        "where my five years have been spent. The posting is unusually specific about troubleshooting "
        "production incidents and performance issues, and that is the part of the job I am best at."),
   fit=("Direct stack overlap on C#, .NET Core, ASP.NET Core Web API, TypeScript, microservices and SQL "
        "tuning. React shipped in production on client projects. The honest caveat is the experience bar: "
        "the posting states eight years and I have five years and three months.")),

 dict(num="068", slug="antas-senior", spec="tailor/antas.yml",
   role="Senior Full Stack Developer (.NET)", company="Antas Pte. Ltd.",
   salary="SGD 9,500 to 11,000 per month, in line with the advertised range.",
   opening=("I am applying for the Senior Full Stack Developer (.NET) role. I am also applying for your "
            "Full Stack Developer opening, and I would rather say that up front than have it look like a "
            "scattergun application: I am happy to be considered for whichever you judge the better fit."),
   intro=("Five years of C# and .NET Core delivery across three companies, with TypeScript front ends and "
          "measurable performance work: up to 30% gains in critical components from full-stack and SQL "
          "optimisation. I held a Senior title from 2023 to 2025 and mentored three to four junior engineers "
          "through code review and technical guidance, which matches the mentoring responsibility in your "
          "posting. Your line about analysing complex technical issues is the work I do most: root-causing "
          "production incidents from source, logs and SQL, including a 97% crash-rate reduction at Hokenso."),
   ach=[A_DOTNET, A_REVIEW, A_SQL, A_RCA],
   problems=("Four gaps worth naming. You ask for three or more years of commercial React or Angular: my "
             "React is production but freelance, and my paid front end has been Vue.js. Microsoft SQL Server "
             "and T-SQL specifically are not on my CV, only general SQL. Your cloud and CI/CD is Azure and "
             "mine is AWS, with no Azure exposure at all. And I have not implemented ASP.NET Core Identity, "
             "JWT, OAuth 2.0 or OpenID Connect. If those are firm, the other opening is the honest match."),
   ask="I would welcome your read on which of the two roles fits better.",
   why=("Same reasons as the Full Stack Developer opening, which I am also applying for. I would rather be "
        "considered for whichever of the two you judge the better fit."),
   fit=("Five years of C# and .NET Core, a Senior title held 2023 to 2025, and mentoring of three to four "
        "juniors. Analysing complex technical issues is my core strength. Against the senior bar I am short "
        "on commercial React or Angular, SQL Server by name, Azure, and the auth stack.")),

 dict(num="062", slug="acp", spec="tailor/java-spring.yml",
   role="Java Software Engineer (Spring Boot / AWS)", company="AC P. Computer Training & Consultancy Pte Ltd",
   salary="SGD 6,800 to 7,500 per month, in line with the advertised range.",
   opening=("I am applying for the Java Software Engineer role. Spring Boot on AWS is what I am building "
            "right now, and full-lifecycle delivery with day-to-day application support is what I have done "
            "for five years."),
   intro=("At Itechoice I am building an AI capability hub on Java Spring Boot, deployed on AWS, "
          "orchestrating skills, knowledge, agents, memory and workflows against a hosted model. The stack "
          "is live rather than something I last touched years ago. Around it sits five years of "
          "full-lifecycle work across three companies, from requirements through post-release support, "
          "inside microservices architectures. Your line on day-to-day application support issues is my "
          "strongest area: I root-cause from source code, logs and SQL, work that cut one application's "
          "crash rate by 97%."),
   ach=[A_JAVA, {"lead": "Full software development lifecycle",
                 "impact": "requirements through development, testing, deployment and post-release support, across three employers."},
        A_RCA, A_SQL],
   problems=("The gap worth naming early is depth of Java. Your posting calls out extensive Java and JEE "
             "enterprise experience, and my hands-on Spring Boot is about nine months in the current role; "
             "my longer backend history is C# and .NET Core. On AWS I have S3 and Lambda but not ECS or "
             "Fargate. My SQL is engine-general rather than PostgreSQL or MySQL by name. I also have no "
             "Automatic Fare Collection or transit-authority domain background, though I read that as an "
             "advantage rather than a requirement."),
   ask="I noticed an identical posting under other company names, so I would like to confirm which vendor holds this requisition and who the end client is.",
   why=("Spring Boot on AWS is what I am building now, and the posting's emphasis on full-lifecycle delivery "
        "with day-to-day application support matches five years of my work."),
   fit=("Live Java Spring Boot and AWS work, five years of full-lifecycle delivery inside microservices, and "
        "application support as my strongest area. Gaps: about nine months hands-on Java, no ECS or Fargate, "
        "no named RDBMS.")),

 dict(num="074", slug="quess", spec="tailor/dotnet-angular-banking.yml",
   role="Software Developer (.NET & Angular)", company="Quess Selection & Services Pte. Ltd.",
   salary="SGD 7,500 to 8,000 per month, negotiable on the overall package.",
   opening=("I am applying for the Software Developer (.NET & Angular) role. I have five years of hands-on "
            "C# and .NET Core delivery, with the production-support and root-cause ownership your posting "
            "describes."),
   intro=BANK_INTRO,
   ach=[A_DOTNET, A_RCA, A_SQL, A_REVIEW],
   problems=("Being straight with you: Angular is half your title and I have not shipped it. My SPA "
             "background is Vue.js and React. I also have no banking-domain experience. If Angular is "
             "non-negotiable, I would rather know at this stage than after a screen."),
   ask=("I would also like to know which client the role sits with, and whether the placement is contract or "
        "permanent, since the posting does not say."),
   why=("The .NET and SQL core of the role maps directly to five years of my delivery work, and the "
        "production-support responsibilities are the part I do best."),
   fit=("Hands-on C# and .NET Core with RESTful APIs and SQL optimisation producing up to 30% gains, plus "
        "security-conscious code review. Real gaps: no Angular, no banking sector background.")),

 dict(num="075", slug="jondavidson", spec="tailor/dotnet-angular-banking.yml",
   role="Software Developer (Angular & .NET)", company="JonDavidson Pte. Ltd.",
   salary="SGD 7,000 to 9,000 per month, negotiable on the overall package.",
   opening=("I am applying for the Software Developer (Angular & .NET) role. My .NET and TypeScript "
            "full-stack experience maps directly to your essential stack, and the troubleshooting and "
            "system-outage responsibilities in your posting are the work I am best at."),
   intro=BANK_INTRO,
   ach=[A_DOTNET, A_RCA, A_SQL, A_REVIEW],
   problems=("Straight about the gaps: Angular is listed as essential and I have not shipped it. My "
             "front-end depth is Vue.js and React. I also have no banking-domain experience. If Angular is a "
             "hard requirement I would rather establish that now."),
   ask=("Since the end client is not named, I would like to know who the role is with and what the "
        "guaranteed base is, rather than the advertised ceiling."),
   why=("The essential .NET and TypeScript stack matches my background directly, and the troubleshooting and "
        "system-outage responsibilities describe the work I am best at."),
   fit=("Five years of C# and .NET Core with TypeScript inside microservices. Production support is my "
        "strongest card, including a 97% crash-rate reduction. No Angular, no banking domain.")),

 dict(num="066", slug="techemerge", spec="tailor/techemerge.yml",
   role="Senior Full Stack Developer (.NET)", company="Techemerge Solutions Pte. Ltd.",
   salary="SGD 8,000 to 10,000 per month, negotiable on the overall package.",
   opening=("I am applying for the Senior Full Stack Developer (.NET) role. My background is C# and .NET "
            "Core backends with React and TypeScript front ends, deployed on AWS, which lines up with the "
            "core of your posting."),
   intro=("Five years across three companies delivering enterprise applications end to end. I held a Senior "
          "title from 2023 to 2025 and mentored three to four junior engineers through code review and "
          "technical guidance. React is real production work for me, delivered on client projects: "
          "plushinteriordesign.sg is a multi-page React application on Vite, live, with an accompanying "
          "React admin CMS. On the backend, full-stack and SQL query optimisation at Itechoice produced up "
          "to 30% gains in critical components, and memory rework at Hokenso cut an application's crash rate "
          "by 97%."),
   ach=[A_REACT, A_DOTNET, {"lead": "AWS and containers",
                            "impact": "S3 and Lambda deployment with build automation scripting at TESS, plus hands-on Docker."}, A_REVIEW],
   problems=("I will not pretend the fit is complete. You ask for at least eight years and I have five. "
             "Several named technologies are not in my record: Next.js, Jest, Storybook, Domain-Driven "
             "Design, OAuth, event-driven architecture, and on AWS specifically API Gateway and DynamoDB, "
             "where my experience is S3 and Lambda. My React is production but freelance rather than "
             "day-job. If the eight-year bar is firm, I understand."),
   ask="If there is a mid-level opening on the same team, I would be glad to be considered for that instead.",
   why=("The core of the role, .NET backends with React and TypeScript on AWS, is my actual background. I "
        "would be upfront that the eight-year bar is above where I am."),
   fit=("Five years, Senior title 2023 to 2025, mentoring three to four juniors, React shipped in "
        "production, AWS and Docker, up to 30% performance gains and a 97% crash-rate reduction. Short on "
        "total years and on Next.js, Jest, Storybook, DDD and event-driven work.")),

 dict(num="076", slug="trinity", spec="tailor/dotnet-angular-banking.yml",
   role="Software Developer (Angular & .NET)", company="Trinity HR Solutions Pte. Ltd.",
   salary="SGD 7,000 to 7,800 per month, in line with the advertised range.",
   opening=("I am applying for the Software Developer (Angular & .NET) role. The .NET side of the title is "
            "where five years of my work sits, and the production-support responsibilities in your posting "
            "are what I do best."),
   intro=BANK_INTRO,
   ach=[A_DOTNET, A_RCA, A_SECURE, A_SQL],
   problems=("Direct about the gaps: no Angular on my record, my SPA work being Vue.js and React, and no "
             "banking or financial-services domain experience. If Angular is a hard requirement rather than "
             "something picked up on the job, I would rather hear that now."),
   ask=("The end client is not disclosed in the posting, so I would like to know who it is and whether this "
        "is a secondment or a direct hire."),
   why=("The .NET core of the role matches five years of my delivery work, and the production-support "
        "responsibilities are the part I am strongest at."),
   fit=("Five years of C# and .NET Core with TypeScript inside microservices, secure code review, and "
        "production incident ownership including a 97% crash-rate reduction. No Angular, no banking domain.")),

 dict(num="056", slug="alpha-x", spec="tailor/java-spring.yml",
   role="Software Engineer (Java & SQL)", company="Alpha X Technology Pte. Ltd.",
   salary=("SGD 6,000 to 6,500 per month. SGD 6,000 is a hard floor for me because it is the Employment "
           "Pass qualifying salary for an on-site Singapore role."),
   opening=("I am applying for the Software Engineer (Java & SQL) role. Java Spring Boot is my current "
            "backend stack, and the performance-tuning line in your posting is close to a description of "
            "what I do."),
   intro=("I am building a production Java Spring Boot platform at Itechoice, deployed on AWS. Behind that "
          "sits five years of full-lifecycle enterprise delivery across three companies, with SQL as a "
          "constant. I design schemas, write and optimise queries, and tune retrieval performance; that work "
          "produced up to 30% gains in critical components. Your requirement around performance tuning for "
          "production systems matches my day-to-day almost word for word, since I root-cause production "
          "issues from source code, logs and SQL queries."),
   ach=[A_JAVA, A_SQL, A_RCA, {"lead": "Full software development lifecycle",
                               "impact": "requirements through development, testing, deployment and post-release support, across three employers."}],
   problems=("Two things to be clear about, and one is about level. Your posting scopes the role at around "
             "two years of experience, while I have five. That is a "
             "downlevel risk for me and a budget question for you: I need to clear SGD 6,000 for Employment "
             "Pass eligibility, so only the top of your range works. If the seat is genuinely a two-year "
             "hire, it is fairer to both of us to say so now. Separately, my SQL is engine-general rather "
             "than SQL Server, Oracle or PostgreSQL by name."),
   ask="I would welcome a conversation if the upper end of the range is achievable.",
   why=("Java Spring Boot is my current backend stack and the posting's performance-tuning requirement is "
        "close to a description of my day-to-day."),
   fit=("Production Java Spring Boot on AWS now, five years of full-lifecycle delivery, and SQL design and "
        "tuning producing up to 30% gains. The open questions are level and budget, not stack.")),

 dict(num="064", slug="recruit-express", spec="tailor/dotnet-lead.yml",
   role="Software Developer Lead (.NET) IFL", company="Recruit Express Pte Ltd",
   salary="SGD 7,500 to 8,500 per month, in line with the advertised range.",
   opening=("I am applying for the Software Developer Lead (.NET) role. Before anything else I should say "
            "that several of your mandatory items are not in my record, and I would rather set that out in "
            "the first paragraph than have it emerge later."),
   intro=("What I do bring is five years of C# and .NET Core delivery across three companies, a Senior title "
          "held from 2023 to 2025, and mentoring of three to four junior engineers through code review and "
          "technical guidance. Your headline responsibility is 360-degree troubleshooting, and that is the "
          "strongest thing I do: root-causing production incidents from source code, application logs and "
          "SQL queries, standing as technical escalation point for customer-reported issues. That work cut "
          "one application's crash rate by 97%, and performance optimisation at Itechoice produced up to 30% "
          "gains in critical components."),
   ach=[{"lead": "End-to-end troubleshooting",
         "impact": "root-cause analysis across source code, logs and SQL, and resolution of bottlenecks spanning front-end, back-end and database layers."},
        A_REVIEW, A_DOTNET, A_SQL],
   problems=("The gaps, plainly. I have not worked with .NET Framework 4.8 specifically; my experience is "
             ".NET and .NET Core, and I see 4.8 flagged mandatory. My SQL is engine-general, not SQL Server "
             "by name, which is also flagged mandatory. My cloud background is AWS, not Azure. I have "
             "mentored engineers but never formally managed a team or held hiring authority, so the Lead "
             "framing is a genuine step up. And I have no legacy-Framework-to-modern-.NET migration story, "
             "which reads as your headline responsibility. If those are firm, I would understand entirely, "
             "and would still be interested in a senior individual-contributor seat on the same team."),
   ask="I would also like to know who the end client is, since the posting does not name them.",
   why=("The 360-degree troubleshooting responsibility is the strongest thing I do. I should say plainly "
        "that several mandatory items are outside my record."),
   fit=("Five years of C# and .NET Core, Senior title 2023 to 2025, mentoring three to four juniors, and "
        "end-to-end troubleshooting including a 97% crash-rate reduction. Against the posting: no .NET "
        "Framework 4.8, no SQL Server by name, no Azure, no formal team management, no migration story.")),

 dict(num="071", slug="altrocks-golang", spec="tailor/dotnet-backend-docker.yml",
   role="Full Stack Developer (Golang/.NET)", company="Altrocks Tech Pte. Ltd.",
   salary=("SGD 6,000 to 6,500 per month. SGD 6,000 is a hard floor because it is the Employment Pass "
           "qualifying salary."),
   opening=("I am applying for the Full Stack Developer role. Your posting asks for strong experience in at "
            "least one of Golang, Python, Node.js or .NET, and I bring two of them: .NET Core and Node.js, "
            "both backed by production delivery."),
   intro=("Five years of backend and full-stack work across three companies. At TESS I built backend "
          "services and RESTful APIs in Node.js, handling JSON and XML integration, deployed on AWS S3 and "
          "Lambda with build automation I wrote. At Itechoice and Hokenso the backend was C# and .NET Core. "
          "Microservices have been the architecture across all three. On the front end your posting lists "
          "React, Angular or Vue.js, and I have shipped both Vue.js and React. Docker is in hands-on use, "
          "which covers your container line."),
   ach=[{"lead": ".NET Core and Node.js, both in production",
         "impact": "two of the four qualifying backend stacks named in your posting, each backed by real delivery."},
        A_DOCKER, A_SQL, A_RCA],
   problems=("To be clear on the gaps: I have not written Golang. I read your requirement as strong "
             "experience in at least one of the four listed stacks rather than Golang specifically, and if "
             "that reading is wrong please tell me. My SQL experience is engine-general rather than tied to "
             "PostgreSQL, MySQL, MongoDB or Redis by name. Kubernetes I have not used, though I see it "
             "listed as an advantage rather than a requirement. On compensation, the advertised range tops "
             "out near my SGD 6,000 floor, so the upper end is where this becomes workable."),
   ask="I would welcome a conversation about the role and the team.",
   why=("The posting asks for strong experience in at least one of four backend stacks, and I bring two of "
        "them with production delivery behind each."),
   fit=(".NET Core and Node.js both in production, microservices across all three employers, Vue.js and "
        "React on the front end, and Docker hands-on. No Golang, no named database engine, no Kubernetes.")),
]

os.makedirs("tailor/covers", exist_ok=True)
for j in JOBS:
    payload = {
        "candidate": CAND,
        "letter": {
            "role_title": j["role"], "company": j["company"], "city": "Singapore", "date": DATE,
            "greeting": "Dear Hiring Manager,",
            "opening": j["opening"], "profile_intro": j["intro"],
            "achievements": j["ach"], "problems_section": j["problems"],
            "closing": CLOSE + j["ask"], "signature": "Yours sincerely,",
        },
        "output_path": f"output/{j['num']}-{j['slug']}/cover.pdf",
    }
    with open(f"tailor/covers/{j['num']}-{j['slug']}.json", "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    # apply.md answers, consumed by build-apply-notes.py
    with open(f"tailor/covers/{j['num']}-{j['slug']}.answers.json", "w") as f:
        json.dump({"salary": j["salary"], "why": j["why"], "fit": j["fit"]}, f, indent=2, ensure_ascii=False)
    print(f"{j['num']}\t{j['slug']}\t{j['spec']}")
