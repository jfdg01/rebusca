import io, subprocess, sys
W = "/tmp/claude-1000/-home-gara-rebusca/47f43071-c655-4fb5-9bf7-177ae2d089c3/scratchpad/it46"
F = W + "/src/app.js"
P = io.open(F, encoding="utf-8").read()
MUT = [
    ("q: el filtro no se normaliza", "    const q = norm(listQ);", "    const q = listQ;"),
    ("q: el filtro vacio filtra igual", "      if (q) {", "      if (true) {"),
    ("#id: la almohadilla no fuerza id",
     '        if (q.startsWith("#")) {', "        if (false) {"),
    ("#id: la almohadilla se queda en la busqueda",
     "          const want = q.slice(1).split(/[,\\s]+/).filter(Boolean);",
     "          const want = q.split(/[,\\s]+/).filter(Boolean);"),
    ("#id: no se parte por comas ni espacios",
     "          const want = q.slice(1).split(/[,\\s]+/).filter(Boolean);",
     "          const want = [q.slice(1)];"),
    ("#id: solo por comas", "          const want = q.slice(1).split(/[,\\s]+/).filter(Boolean);",
     '          const want = q.slice(1).split(",").filter(Boolean);'),
    ("#id: los huecos vacios cuentan",
     "          const want = q.slice(1).split(/[,\\s]+/).filter(Boolean);",
     "          const want = q.slice(1).split(/[,\\s]+/);"),
    ("#id: tienen que casar todos", "          if (!want.some((w) => id.includes(w))) return false;",
     "          if (!want.every((w) => id.includes(w))) return false;"),
    ("#id: el id tiene que ser exacto", "          if (!want.some((w) => id.includes(w))) return false;",
     "          if (!want.some((w) => id === w)) return false;"),
    ("texto: no casa por id",
     '        } else if (!norm(col(r, "titulo") || "").includes(q) && !id.includes(q)) return false;',
     '        } else if (!norm(col(r, "titulo") || "").includes(q)) return false;'),
    ("texto: no casa por titulo",
     '        } else if (!norm(col(r, "titulo") || "").includes(q) && !id.includes(q)) return false;',
     "        } else if (!id.includes(q)) return false;"),
    ("texto: el titulo no se normaliza",
     '        } else if (!norm(col(r, "titulo") || "").includes(q) && !id.includes(q)) return false;',
     '        } else if (!(col(r, "titulo") || "").includes(q) && !id.includes(q)) return false;'),
    ("vendedor: el filtro no se aplica",
     '      if (view === "rejected" && listSeller && col(r, "vendedor") !== listSeller) return false;',
     "      if (false) return false;"),
    ("vendedor: tambien en favoritos",
     '      if (view === "rejected" && listSeller && col(r, "vendedor") !== listSeller) return false;',
     '      if (listSeller && col(r, "vendedor") !== listSeller) return false;'),
    ("orden: la lista no se ordena", "    sortList(rows);", "    ;"),
]
sel = sys.argv[1:]
for nom, old, new in MUT:
    if sel and not any(s in nom for s in sel): continue
    n = P.count(old)
    if n != 1:
        print("%-46s MUTADOR ROTO (%d)" % (nom, n)); sys.stdout.flush(); continue
    io.open(F, "w", encoding="utf-8").write(P.replace(old, new))
    rc = subprocess.run(["./check.sh"], cwd=W, capture_output=True).returncode
    r = subprocess.run(["node", "src/test_buttons.js"], cwd=W, capture_output=True, text=True)
    linea = ""
    for l in (r.stdout + r.stderr).splitlines():
        if "FAIL" in l or "AssertionError" in l or "Error" in l:
            linea = l.strip()[:70]; break
    print("%-46s %-6s %s" % (nom, "muere" if rc else "VIVE", linea)); sys.stdout.flush()
    io.open(F, "w", encoding="utf-8").write(P)
