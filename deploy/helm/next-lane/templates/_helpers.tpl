{{/*
Expand the name of the chart.
*/}}
{{- define "next-lane.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name (release-name prefixed).
*/}}
{{- define "next-lane.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart name and version label value.
*/}}
{{- define "next-lane.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels applied to every object.
*/}}
{{- define "next-lane.labels" -}}
helm.sh/chart: {{ include "next-lane.chart" . }}
{{ include "next-lane.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: next-lane
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Selector labels (stable identity — never include version here).
*/}}
{{- define "next-lane.selectorLabels" -}}
app.kubernetes.io/name: {{ include "next-lane.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Per-component (api/web) full name, e.g. "rel-next-lane-api".
Usage: include "next-lane.componentName" (dict "ctx" . "component" "api")
*/}}
{{- define "next-lane.componentName" -}}
{{- printf "%s-%s" (include "next-lane.fullname" .ctx) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Per-component selector labels.
*/}}
{{- define "next-lane.componentSelectorLabels" -}}
{{ include "next-lane.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Per-component full labels.
*/}}
{{- define "next-lane.componentLabels" -}}
{{ include "next-lane.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
ServiceAccount name.
*/}}
{{- define "next-lane.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "next-lane.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Name of the Secret the app reads JWT_SECRET / DATABASE_URL / REDIS_URL from.
Either the user-supplied existingSecret or the chart-managed one.
*/}}
{{- define "next-lane.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "next-lane.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Resolve the API image reference (repository:tag), defaulting tag to AppVersion.
*/}}
{{- define "next-lane.apiImage" -}}
{{- $tag := default .Chart.AppVersion .Values.image.api.tag -}}
{{- printf "%s:%s" .Values.image.api.repository $tag -}}
{{- end -}}

{{/*
Resolve the web image reference.
*/}}
{{- define "next-lane.webImage" -}}
{{- $tag := default .Chart.AppVersion .Values.image.web.tag -}}
{{- printf "%s:%s" .Values.image.web.repository $tag -}}
{{- end -}}

{{/*
DATABASE_URL when the bundled PostgreSQL subchart is enabled. Points at the
Bitnami primary service inside the release namespace.
*/}}
{{- define "next-lane.bundledDatabaseUrl" -}}
{{- $pg := .Values.postgresql -}}
{{- $host := printf "%s-postgresql" .Release.Name -}}
{{- printf "postgresql://%s:%s@%s:5432/%s?schema=public" $pg.auth.username $pg.auth.password $host $pg.auth.database -}}
{{- end -}}

{{/*
REDIS_URL when the bundled Redis subchart is enabled.
*/}}
{{- define "next-lane.bundledRedisUrl" -}}
{{- $host := printf "%s-redis-master" .Release.Name -}}
{{- if .Values.redis.auth.enabled -}}
{{- printf "redis://:%s@%s:6379" .Values.redis.auth.password $host -}}
{{- else -}}
{{- printf "redis://%s:6379" $host -}}
{{- end -}}
{{- end -}}

{{/*
DATABASE_URL assembled from externalDatabase parts (when a full URL isn't given).
*/}}
{{- define "next-lane.externalDatabaseUrl" -}}
{{- $db := .Values.externalDatabase -}}
{{- printf "postgresql://%s:%s@%s:%v/%s?%s" $db.user $db.password $db.host $db.port $db.database $db.params -}}
{{- end -}}

{{/*
REDIS_URL assembled from externalRedis parts (empty string when no host set).
*/}}
{{- define "next-lane.externalRedisUrl" -}}
{{- $r := .Values.externalRedis -}}
{{- if $r.host -}}
{{- if $r.password -}}
{{- printf "redis://:%s@%s:%v" $r.password $r.host $r.port -}}
{{- else -}}
{{- printf "redis://%s:%v" $r.host $r.port -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Effective CORS origins: explicit override, else https://<ingress host> when
ingress is enabled, else empty (API falls back to its own default).
*/}}
{{- define "next-lane.corsOrigins" -}}
{{- if .Values.api.env.corsOrigins -}}
{{- .Values.api.env.corsOrigins -}}
{{- else if .Values.ingress.enabled -}}
{{- printf "https://%s" .Values.ingress.host -}}
{{- end -}}
{{- end -}}

{{/*
Image pull secrets block.
*/}}
{{- define "next-lane.imagePullSecrets" -}}
{{- with .Values.image.pullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/*
Guard: scaling the api past one pod silently breaks uploads.

Attachments and workspace logos are written to api.uploads.mountPath. That
path is node-local in BOTH default configurations:

  - persistence.enabled=false (the default) -> emptyDir, private to each pod
  - persistence.enabled=true with ReadWriteOnce -> exactly one node may mount it

Either way a second api replica serves a filesystem that is missing whatever
the other pod wrote. Uploads appear to succeed and then 404 for a fraction of
requests proportional to replica count — a fault nobody attributes to Helm
values. Only ReadWriteMany (or moving uploads off the pod entirely) makes the
api horizontally scalable.

values.yaml has carried a comment about this since the chart was written. A
comment is not a constraint: `api.autoscaling.enabled=true` is one flag and
nothing stopped it. This fails the render instead, with the fix in the message.
*/}}
{{- define "next-lane.validateUploadsScaling" -}}
{{- $p := .Values.api.uploads.persistence -}}
{{- $shared := and $p.enabled (has "ReadWriteMany" (default (list) $p.accessModes)) -}}
{{- if not $shared -}}
{{- $how := ternary "a ReadWriteOnce PVC" "an emptyDir (api.uploads.persistence.enabled=false)" $p.enabled -}}
{{- $fix := "Set api.uploads.persistence.enabled=true with accessModes: [\"ReadWriteMany\"], or keep the api at a single pod." -}}
{{- if .Values.api.autoscaling.enabled -}}
{{- fail (printf "next-lane: api.autoscaling.enabled=true, but uploads live on %s, which is node-local. A second api pod would serve a filesystem missing the other pod's attachments and logos, so they would 404 intermittently. %s" $how $fix) -}}
{{- end -}}
{{- if gt (int (default 1 .Values.api.replicaCount)) 1 -}}
{{- fail (printf "next-lane: api.replicaCount=%d, but uploads live on %s, which is node-local. Attachments and logos written by one pod would 404 when another serves the request. %s" (int .Values.api.replicaCount) $how $fix) -}}
{{- end -}}
{{- end -}}
{{- end -}}
